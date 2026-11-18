import { randomBytes, randomInt } from 'node:crypto'
import { db } from '../../db'
import { config } from '../../config'
import { serverKid, signToken, verifyServerToken } from '../../lib/crypto'
import { activeVouchers } from '../vouchers/service'

/** 10 цифр: перебор нереален, а кассир/гость легко диктует номер. */
const CARD_CODE_MIN = 1_000_000_000
const CARD_CODE_MAX = 9_999_999_999
/** Сколько раз пробуем взять свободный код, прежде чем сдаться. */
const CARD_CODE_ATTEMPTS = 8

function randomCardCode(): string {
  return String(randomInt(CARD_CODE_MIN, CARD_CODE_MAX + 1))
}

/**
 * Номер карты, который кассир видит в приложении/на карте, показывается с пробелами
 * каждые 4 цифры (`formatCardCode` в PWA). Кассир может ввести его как видит —
 * поэтому разделители (пробелы, неразрывные пробелы, дефисы) отбрасываем до проверки.
 */
export function normalizeCardCode(value: string): string | null {
  const raw = value.replace(/[\s\u00a0\u2010-\u2015\u2212-]+/g, '').trim()
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
    /**
     * P0-02: номер карты — CSPRNG, а не `MAX+1`.
     *
     * Раньше коды шли подряд (1, 2, 3, …), а `POST /resolve` принимает код без QR.
     * Перебор «соседнего» номера был тривиальным. 10 цифр из `randomInt` дают
     * ~9·10⁹ вариантов; столкновение ловит UNIQUE на `users.card_code`, и мы
     * просто пробуем ещё раз. Старые короткие коды продолжают работать:
     * `normalizeCardCode` принимает 1–18 цифр.
     */
    for (let attempt = 0; attempt < CARD_CODE_ATTEMPTS; attempt += 1) {
      const candidate = randomCardCode()
      if (db.prepare('SELECT 1 FROM users WHERE card_code=?').get(candidate)) continue
      try {
        const res = db.prepare('UPDATE users SET card_code=? WHERE id=? AND card_code IS NULL').run(candidate, userId)
        if (res.changes === 1) return candidate
        // Параллельный запрос уже выдал код — читаем его.
        const now = db.prepare('SELECT card_code FROM users WHERE id=?').get(userId) as { card_code: string | null } | undefined
        const settled = now?.card_code ? normalizeCardCode(now.card_code) : null
        if (settled) return settled
      } catch {
        // UNIQUE(card_code) — код успели занять, пробуем следующий.
        continue
      }
    }
    throw new Error('card_code_generation_failed')
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
