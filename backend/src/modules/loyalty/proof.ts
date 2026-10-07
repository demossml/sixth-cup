import { randomBytes } from 'node:crypto'
import { db } from '../../db'
import { config } from '../../config'
import { serverKid, signToken, verifyServerToken } from '../../lib/crypto'
import { activeVouchers } from '../vouchers/service'

export function normalizeCardCode(value: string): string | null {
  const raw = value.trim()
  if (!/^\d{1,18}$/.test(raw)) return null
  const normalized = raw.replace(/^0+(?=\d)/, '')
  return normalized || '0'
}

/** Assigns a short human-readable numeric code once and keeps it stable. */
export function ensureCardCode(userId: number): string | null {
  const existing = db.prepare('SELECT card_code FROM users WHERE id=?').get(userId) as { card_code: string | null } | undefined
  if (!existing) return null
  if (existing.card_code && normalizeCardCode(existing.card_code)) return normalizeCardCode(existing.card_code)

  const assign = db.transaction(() => {
    const again = db.prepare('SELECT card_code FROM users WHERE id=?').get(userId) as { card_code: string | null } | undefined
    if (!again) return null
    if (again.card_code && normalizeCardCode(again.card_code)) return normalizeCardCode(again.card_code)
    const row = db.prepare(`
      SELECT COALESCE(MAX(CAST(card_code AS INTEGER)), 0) + 1 AS next_code
      FROM users
      WHERE card_code GLOB '[0-9]*' AND card_code <> ''
    `).get() as { next_code: number }
    const code = String(Math.max(1, Math.floor(row.next_code)))
    db.prepare('UPDATE users SET card_code=? WHERE id=? AND card_code IS NULL').run(code, userId)
    return code
  })
  return assign()
}

export function ensureCard(userId: number) {
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(userId, Date.now())
  ensureCardCode(userId)
  const row = db.prepare('SELECT card_id FROM users WHERE id=?').get(userId) as { card_id: string | null } | undefined
  if (!row) return
  if (!row.card_id) {
    const id = randomBytes(18).toString('base64url')
    db.prepare('UPDATE users SET card_id=? WHERE id=? AND card_id IS NULL').run(id, userId)
  }
}

export type VerifiedCard = {
  userId: number
  cardId: string
  q: number
  paidTotal: number
  freeUsed: number
  cashback: number
  vouchers: ReturnType<typeof activeVouchers>
  issuedAt: number
  expiresAt: number
  kid: string
}

export function buildCardProof(userId: number): string {
  ensureCard(userId)
  const u = db.prepare('SELECT card_id FROM users WHERE id=?')
    .get(userId) as { card_id: string }
  const now = Math.floor(Date.now() / 1000)
  return signToken({
    t: 'c',
    ver: 2,
    id: u.card_id,
    i: now,
    exp: now + config.cardQrTtlSec,
    kid: serverKid,
  })
}

export function verifyCardProof(token: string): VerifiedCard | null {
  const p = verifyServerToken(token)
  if (!p || p.t !== 'c' || p.ver !== 2) return null
  if (typeof p.id !== 'string' || !p.id) return null
  const user = db.prepare('SELECT id FROM users WHERE card_id=?').get(p.id) as { id: number } | undefined
  if (!user) return null
  return {
    userId: user.id,
    cardId: p.id,
    q: 0,
    paidTotal: 0,
    freeUsed: 0,
    cashback: 0,
    vouchers: [],
    issuedAt: typeof p.i === 'number' ? p.i : 0,
    expiresAt: typeof p.exp === 'number' ? p.exp : 0,
    kid: String(p.kid ?? ''),
  }
}
