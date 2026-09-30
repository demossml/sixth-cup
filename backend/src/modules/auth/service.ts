import { randomBytes } from 'node:crypto'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { ensureCard } from '../loyalty/proof'
import { grantVoucher } from '../vouchers/service'

const WINDOW_MS = 60 * 60_000 // 1 hour
const MAX_SEND_PER_PHONE = 3
const MAX_SEND_PER_IP = 20
const MAX_VERIFY_ATTEMPTS = 5

function checkRateLimit(key: string, max: number) {
  const now = Date.now()
  const row = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?')
    .get(key) as { count: number; window_start: number } | undefined
  if (!row || now - row.window_start > WINDOW_MS) {
    db.prepare('INSERT OR REPLACE INTO rate_limits(key, count, window_start) VALUES(?,?,?)')
      .run(key, 1, now)
    return
  }
  if (row.count >= max) throw bad('Слишком много запросов. Попробуйте позже.', 429)
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key=?').run(key)
}

export function sendCode(phone: string, ip?: string) {
  checkRateLimit(`sms:phone:${phone}`, MAX_SEND_PER_PHONE)
  if (ip) checkRateLimit(`sms:ip:${ip}`, MAX_SEND_PER_IP)

  const code = String(Math.floor(1000 + Math.random() * 9000))
  db.prepare('INSERT OR REPLACE INTO sms_codes(phone, code, expires_at, attempts) VALUES(?,?,?,0)')
    .run(phone, code, Date.now() + 5 * 60_000)
  // Production: send via SMS.ru / SMSC / Devino when !config.isDev
  return code
}

const registerUser = db.transaction((phone: string, inviteCode?: string) => {
  const inviter = inviteCode
    ? (db.prepare('SELECT id FROM users WHERE invite_code=?').get(inviteCode.toUpperCase()) as { id: number } | undefined)
    : undefined
  const r = db.prepare('INSERT INTO users(phone,nickname,invite_code,invited_by,created_at) VALUES(?,?,?,?,?)')
    .run(phone, `Гость ${phone.slice(-4)}`, randomBytes(4).toString('hex').toUpperCase(), inviter?.id ?? null, Date.now())
  const userId = Number(r.lastInsertRowid)
  ensureCard(userId)
  grantVoucher(userId, 'WELCOME')
  return userId
})

export function verifyCodeAndLogin(input: { phone: string; code: string; inviteCode?: string }): number {
  const row = db.prepare('SELECT code, expires_at, attempts FROM sms_codes WHERE phone=?')
    .get(input.phone) as { code: string; expires_at: number; attempts: number } | undefined

  if (!row) throw bad('Неверный или просроченный код')
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sms_codes WHERE phone=?').run(input.phone)
    throw bad('Неверный или просроченный код')
  }
  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    throw bad('Слишком много попыток. Запросите новый код.', 429)
  }
  if (row.code !== input.code) {
    db.prepare('UPDATE sms_codes SET attempts = attempts + 1 WHERE phone=?').run(input.phone)
    throw bad('Неверный или просроченный код')
  }
  db.prepare('DELETE FROM sms_codes WHERE phone=?').run(input.phone)

  const existing = db.prepare('SELECT id FROM users WHERE phone=?').get(input.phone) as { id: number } | undefined
  return existing?.id ?? registerUser(input.phone, input.inviteCode)
}
