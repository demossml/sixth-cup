import { randomBytes } from 'node:crypto'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { verifyServerToken } from '../../lib/crypto'
import { ensureCard, ensureCardCode, normalizeCardCode } from './proof'
import { activeVouchers } from '../vouchers/service'

const TTL_MS = 90_000
const FREE_EVERY = 6

export type ResolveResult = {
  cardCode: string | null
  cardId: string
  userId: number
  paidCups: number
  freeUsed: number
  cupsTowardFree: number
  freeAvailable: boolean
  cashbackKopecks: number
  vouchers: ReturnType<typeof activeVouchers>
  reservationId: string | null
  reservationExpiresAt: number | null
  benefit: 'FREE_CUP' | 'NONE'
}

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS loyalty_reservations (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      benefit TEXT NOT NULL,
      status TEXT NOT NULL,
      store_uuid TEXT,
      terminal_id TEXT,
      card_ref TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      consumed_at INTEGER,
      sell_doc_id TEXT,
      paid_cups_snapshot INTEGER NOT NULL DEFAULT 0,
      free_available_snapshot INTEGER NOT NULL DEFAULT 0,
      cashback_snapshot INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_loyalty_res_user_status ON loyalty_reservations(user_id, status);
  `)
}

function expireStale(userId?: number) {
  const now = Date.now()
  if (userId != null) {
    db.prepare(`UPDATE loyalty_reservations SET status='EXPIRED' WHERE user_id=? AND status='RESERVED' AND expires_at<?`)
      .run(userId, now)
  } else {
    db.prepare(`UPDATE loyalty_reservations SET status='EXPIRED' WHERE status='RESERVED' AND expires_at<?`).run(now)
  }
}

function findUserByCardRef(raw: string): { id: number; card_id: string; card_code: string | null; cashback_balance: number } {
  const trimmed = raw.trim()
  if (!trimmed) throw bad('Empty card', 400)

  if (trimmed.includes('.')) {
    const card = verifyServerToken(trimmed)
    if (!card || card.t !== 'c' || card.ver !== 2 || typeof card.id !== 'string') {
      throw bad('Invalid card token', 400)
    }
    const user = db.prepare('SELECT id, card_id, card_code, cashback_balance FROM users WHERE card_id=?')
      .get(card.id) as { id: number; card_id: string; card_code: string | null; cashback_balance: number } | undefined
    if (!user) throw bad('Card not found', 404)
    return user
  }

  const code = normalizeCardCode(trimmed)
  if (!code) throw bad('Invalid card code', 400)
  const user = db.prepare(`
    SELECT id, card_id, card_code, cashback_balance FROM users
    WHERE card_code=? OR CAST(card_code AS INTEGER)=CAST(? AS INTEGER) LIMIT 1
  `).get(code, code) as { id: number; card_id: string; card_code: string | null; cashback_balance: number } | undefined
  if (!user) throw bad('Card code not found', 404)
  if (!user.card_id) {
    ensureCard(user.id)
    const again = db.prepare('SELECT id, card_id, card_code, cashback_balance FROM users WHERE id=?')
      .get(user.id) as typeof user
    if (!again?.card_id) throw bad('Card not ready', 409)
    return again
  }
  return user
}

/**
 * Resolve live loyalty state and optionally reserve FREE_CUP for ~90s.
 * QR is only identity — state always comes from DB.
 */
export function resolveAndReserve(input: {
  cardRef: string
  storeUuid?: string | null
  terminalId?: string | null
  reserveFree?: boolean
}): ResolveResult {
  ensureSchema()
  const user = findUserByCardRef(input.cardRef)
  ensureCard(user.id)
  ensureCardCode(user.id)
  expireStale(user.id)

  const c = db.prepare('SELECT paid_total, free_used, seq FROM cards WHERE user_id=?')
    .get(user.id) as { paid_total: number; free_used: number; seq: number }
  if (!c) throw bad('Card state missing', 404)

  const paidCups = c.paid_total
  const freeUsed = c.free_used
  const earned = Math.floor(paidCups / FREE_EVERY)
  const freeAvailable = earned > freeUsed
  const cupsTowardFree = paidCups % FREE_EVERY
  const vouchers = activeVouchers(user.id)
  const cardCode = ensureCardCode(user.id)
  const cardId = (db.prepare('SELECT card_id FROM users WHERE id=?').get(user.id) as { card_id: string }).card_id

  let reservationId: string | null = null
  let reservationExpiresAt: number | null = null
  let benefit: 'FREE_CUP' | 'NONE' = 'NONE'

  const reserveFree = input.reserveFree !== false

  if (reserveFree && freeAvailable) {
    const existing = db.prepare(`
      SELECT id, expires_at FROM loyalty_reservations
      WHERE user_id=? AND status='RESERVED' AND benefit='FREE_CUP' AND expires_at>?
      LIMIT 1
    `).get(user.id, Date.now()) as { id: string; expires_at: number } | undefined

    if (existing) {
      reservationId = existing.id
      reservationExpiresAt = existing.expires_at
      benefit = 'FREE_CUP'
    } else {
      const id = `R-${randomBytes(8).toString('hex')}`
      const exp = Date.now() + TTL_MS
      try {
        db.prepare(`
          INSERT INTO loyalty_reservations(
            id, user_id, benefit, status, store_uuid, terminal_id, card_ref,
            expires_at, created_at, paid_cups_snapshot, free_available_snapshot, cashback_snapshot
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          id, user.id, 'FREE_CUP', 'RESERVED',
          input.storeUuid ?? null, input.terminalId ?? null, input.cardRef.slice(0, 200),
          exp, Date.now(), paidCups, 1, user.cashback_balance,
        )
        reservationId = id
        reservationExpiresAt = exp
        benefit = 'FREE_CUP'
      } catch {
        // race: another reservation won
        const again = db.prepare(`
          SELECT id, expires_at FROM loyalty_reservations
          WHERE user_id=? AND status='RESERVED' AND benefit='FREE_CUP' AND expires_at>? LIMIT 1
        `).get(user.id, Date.now()) as { id: string; expires_at: number } | undefined
        if (again) {
          reservationId = again.id
          reservationExpiresAt = again.expires_at
          benefit = 'FREE_CUP'
        }
      }
    }
  }

  return {
    cardCode,
    cardId,
    userId: user.id,
    paidCups,
    freeUsed,
    cupsTowardFree,
    freeAvailable: benefit === 'FREE_CUP' || freeAvailable,
    cashbackKopecks: user.cashback_balance,
    vouchers,
    reservationId,
    reservationExpiresAt,
    benefit,
  }
}

export function consumeReservation(reservationId: string, sellDocId: string): boolean {
  ensureSchema()
  expireStale()
  const row = db.prepare(`SELECT id, status, expires_at FROM loyalty_reservations WHERE id=?`)
    .get(reservationId) as { id: string; status: string; expires_at: number } | undefined
  if (!row) return false
  if (row.status === 'CONSUMED') return true
  if (row.status !== 'RESERVED') return false
  if (row.expires_at < Date.now()) {
    db.prepare(`UPDATE loyalty_reservations SET status='EXPIRED' WHERE id=?`).run(reservationId)
    return false
  }
  db.prepare(`
    UPDATE loyalty_reservations SET status='CONSUMED', consumed_at=?, sell_doc_id=? WHERE id=? AND status='RESERVED'
  `).run(Date.now(), sellDocId, reservationId)
  return true
}
