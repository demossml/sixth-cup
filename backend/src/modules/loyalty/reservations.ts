import { randomBytes } from 'node:crypto'
import { db } from '../../db'
import { config } from '../../config'
import { verifyServerToken } from '../../lib/crypto'
import { normalizeCardCode } from './proof'
import { freeEarned } from './rules'

export type ResolveInput = { code: string; storeUuid?: string; deviceUuid?: string }

export type ResolveResult =
  | { ok: false; error: 'invalid_card' | 'card_not_found' | 'card_blocked' }
  | {
      ok: true
      cardCode: string
      kind: 'token' | 'code'
      paidCups: number
      cupsForFree: number
      freeAvailable: number
      cashback: number
      /** Cashback in kopecks that this reservation allows to spend. */
      cashbackReserved: number
      reservationId: string | null
      reservationExpiresAt: number | null
      /** FREE_RESERVED | FREE_ALREADY_RESERVED | NONE */
      freeStatus: 'RESERVED' | 'ALREADY_RESERVED' | 'NONE'
    }

type UserRow = { id: number; card_id: string; card_code: string; cashback_balance: number }

function findUser(code: string): { user: UserRow; kind: 'token' | 'code' } | 'invalid' | 'missing' {
  const raw = code.trim()
  if (raw.includes('.')) {
    const p = verifyServerToken(raw)
    if (!p || p.t !== 'c' || p.ver !== 2 || typeof p.id !== 'string') return 'invalid'
    const user = db.prepare('SELECT id, card_id, card_code, cashback_balance FROM users WHERE card_id=?').get(p.id) as UserRow | undefined
    return user ? { user, kind: 'token' } : 'missing'
  }
  const digits = normalizeCardCode(raw)
  if (!digits) return 'invalid'
  const user = db.prepare('SELECT id, card_id, card_code, cashback_balance FROM users WHERE card_code=?').get(digits) as UserRow | undefined
  return user ? { user, kind: 'code' } : 'missing'
}

export function newReservationId(): string {
  return 'R-' + randomBytes(9).toString('base64url')
}

/**
 * Identify the customer and (for a signed QR only) reserve the available benefit.
 * A manually typed numeric code identifies the card for accrual only: it never
 * reserves or spends bonuses, because card numbers are guessable.
 */
export function resolveAndReserve(input: ResolveInput, now = Date.now()): ResolveResult {
  const found = findUser(input.code)
  if (found === 'invalid') return { ok: false, error: 'invalid_card' }
  if (found === 'missing') return { ok: false, error: 'card_not_found' }
  const { user, kind } = found
  if (db.prepare('SELECT 1 FROM card_denylist WHERE card_id=? AND released_at IS NULL').get(user.card_id)) return { ok: false, error: 'card_blocked' }

  const card = (db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?').get(user.id) ?? { paid_total: 0, free_used: 0 }) as {
    paid_total: number; free_used: number
  }
  const freeAvailable = Math.max(0, freeEarned(card.paid_total) - card.free_used)
  const base = {
    ok: true as const,
    cardCode: user.card_code,
    kind,
    paidCups: card.paid_total % config.cupsForFree,
    cupsForFree: config.cupsForFree,
    freeAvailable,
    cashback: user.cashback_balance,
  }
  if (kind === 'code') {
    return { ...base, freeAvailable: 0, cashback: 0, cashbackReserved: 0, reservationId: null, reservationExpiresAt: null, freeStatus: 'NONE' }
  }

  const nowSec = Math.floor(now / 1000)
  const ttl = Math.max(30, config.reservationTtlSec)
  return db.transaction(() => {
    db.prepare(`UPDATE loyalty_reservations SET status='EXPIRED' WHERE card_id=? AND status='RESERVED' AND expires_at<=?`).run(user.card_id, nowSec)
    const active = db.prepare(`SELECT id, expires_at, benefit_free, benefit_cb FROM loyalty_reservations WHERE card_id=? AND status='RESERVED'`)
      .get(user.card_id) as { id: string; expires_at: number; benefit_free: number; benefit_cb: number } | undefined
    if (active) {
      // Same till asking again (rescan) may refresh its own hold; other tills see "already reserved".
      const mine = db.prepare('SELECT device_uuid, store_uuid FROM loyalty_reservations WHERE id=?').get(active.id) as { device_uuid: string | null; store_uuid: string | null }
      const same = (input.deviceUuid ?? '') === (mine.device_uuid ?? '') && (input.storeUuid ?? '') === (mine.store_uuid ?? '')
      if (same) {
        db.prepare('UPDATE loyalty_reservations SET expires_at=? WHERE id=?').run(nowSec + ttl, active.id)
        return { ...base, freeAvailable: active.benefit_free ? 1 : 0, cashbackReserved: active.benefit_cb, reservationId: active.id, reservationExpiresAt: nowSec + ttl, freeStatus: active.benefit_free ? 'RESERVED' as const : 'NONE' as const }
      }
      return { ...base, freeAvailable: 0, cashback: 0, cashbackReserved: 0, reservationId: null, reservationExpiresAt: null, freeStatus: 'ALREADY_RESERVED' as const }
    }
    const id = newReservationId()
    const free = freeAvailable > 0 ? 1 : 0
    const cb = Math.max(0, user.cashback_balance)
    db.prepare(`INSERT INTO loyalty_reservations(id,card_id,benefit_free,benefit_cb,store_uuid,device_uuid,status,created_at,expires_at) VALUES(?,?,?,?,?,?, 'RESERVED', ?,?)`)
      .run(id, user.card_id, free, cb, input.storeUuid ?? null, input.deviceUuid ?? null, nowSec, nowSec + ttl)
    return { ...base, freeAvailable: free, cashbackReserved: cb, reservationId: id, reservationExpiresAt: nowSec + ttl, freeStatus: free ? 'RESERVED' as const : 'NONE' as const }
  })()
}

/**
 * Called by SellHandler. Returns the benefits the reservation allows for this card.
 * A reservation that expired before the receipt was polled may still be honoured
 * (the till was slow), but never twice: the first consumer wins and the card state clamps the rest.
 */
export function consumeReservation(conn: typeof db, opId: string | null | undefined, cardId: string, docStore: string, docId: string, now = Date.now()): { free: number; cb: number } {
  if (!opId) return { free: 0, cb: 0 }
  const row = conn.prepare(`SELECT status, benefit_free, benefit_cb FROM loyalty_reservations WHERE id=? AND card_id=?`)
    .get(opId, cardId) as { status: string; benefit_free: number; benefit_cb: number } | undefined
  if (!row || (row.status !== 'RESERVED' && row.status !== 'EXPIRED')) return { free: 0, cb: 0 }
  const r = conn.prepare(`UPDATE loyalty_reservations SET status='CONSUMED', consumed_at=?, doc_store=?, doc_id=? WHERE id=? AND status IN ('RESERVED','EXPIRED')`)
    .run(now, docStore, docId, opId)
  if (r.changes !== 1) return { free: 0, cb: 0 }
  return { free: row.benefit_free, cb: row.benefit_cb }
}

export function expireStaleReservations(now = Date.now()): number {
  return db.prepare(`UPDATE loyalty_reservations SET status='EXPIRED' WHERE status='RESERVED' AND expires_at<=?`).run(Math.floor(now / 1000)).changes
}
