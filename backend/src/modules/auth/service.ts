import { randomBytes } from 'node:crypto'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { ensureCard } from '../loyalty/proof'
import { grantVoucher } from '../vouchers/service'

export function sendCode(phone: string) {
  const code = String(Math.floor(1000 + Math.random() * 9000))
  db.prepare('INSERT OR REPLACE INTO sms_codes(phone, code, expires_at) VALUES(?,?,?)')
    .run(phone, code, Date.now() + 5 * 60_000)
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
  const row = db.prepare('SELECT code, expires_at FROM sms_codes WHERE phone=?')
    .get(input.phone) as { code: string; expires_at: number } | undefined
  if (!row || row.code !== input.code || row.expires_at < Date.now()) throw bad('Неверный или просроченный код')
  db.prepare('DELETE FROM sms_codes WHERE phone=?').run(input.phone)

  const existing = db.prepare('SELECT id FROM users WHERE phone=?').get(input.phone) as { id: number } | undefined
  return existing?.id ?? registerUser(input.phone, input.inviteCode)
}
