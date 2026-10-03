import { createHash, randomBytes, randomInt } from 'node:crypto'
import { config } from '../../config'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { normalizePhone } from '../../lib/phone'
import { getSmsProvider } from '../../lib/sms'
import { ensureCard } from '../loyalty/proof'
import { grantVoucher } from '../vouchers/service'

const WINDOW_MS = 60 * 60_000
const MAX_SEND_PER_PHONE = 5
const MAX_SEND_PER_IP = 20
const MAX_VERIFY_ATTEMPTS = 5

function checkRateLimit(key: string, max: number, windowMs = WINDOW_MS) {
  const now = Date.now()
  const row = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?')
    .get(key) as { count: number; window_start: number } | undefined
  if (!row || now - row.window_start > windowMs) {
    db.prepare('INSERT OR REPLACE INTO rate_limits(key, count, window_start) VALUES(?,?,?)')
      .run(key, 1, now)
    return
  }
  if (row.count >= max) throw bad('Слишком много запросов. Попробуйте позже.', 429)
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key=?').run(key)
}

function checkResendCooldown(phone: string) {
  const key = `sms:cd:${phone}`
  const now = Date.now()
  const row = db.prepare('SELECT window_start FROM rate_limits WHERE key=?')
    .get(key) as { window_start: number } | undefined
  if (row && now - row.window_start < config.otpResendCooldownMs) {
    throw bad('Подождите перед повторной отправкой кода.', 429)
  }
  db.prepare('INSERT OR REPLACE INTO rate_limits(key, count, window_start) VALUES(?,?,?)')
    .run(key, 1, now)
}

function hashOtp(phone: string, code: string): string {
  return createHash('sha256')
    .update(`${phone}:${code}:${config.jwtSecret}`)
    .digest('hex')
}

function generateOtp(): string {
  const max = 10 ** config.otpLength
  const n = randomInt(0, max)
  return String(n).padStart(config.otpLength, '0')
}

/**
 * Send OTP via configured SmsProvider. Returns plaintext code only for mock/dev test hooks.
 * Production never relies on return value for SMS delivery.
 */
export async function sendCode(phoneRaw: string, ip?: string): Promise<{ devCode?: string }> {
  const phone = normalizePhone(phoneRaw)
  checkRateLimit(`sms:phone:${phone}`, MAX_SEND_PER_PHONE)
  if (ip) checkRateLimit(`sms:ip:${ip}`, MAX_SEND_PER_IP)
  checkResendCooldown(phone)

  const code = generateOtp()
  const codeHash = hashOtp(phone, code)
  db.prepare('INSERT OR REPLACE INTO sms_codes(phone, code, expires_at, attempts) VALUES(?,?,?,0)')
    .run(phone, codeHash, Date.now() + config.otpTtlMs)

  const message = config.smsOtpTemplate.replace('{code}', code)
  const provider = getSmsProvider()
  console.log('[sms] OTP request', provider.name, phone.replace(/\d(?=\d{4})/g, '*'))

  await provider.send({ phone, message })

  const allowDevCode =
    config.isDev && (config.smsProvider === 'mock' || provider.name === 'mock')
  return { devCode: allowDevCode ? code : undefined }
}

const registerUser = db.transaction((phone: string, inviteCode?: string) => {
  const inviter = inviteCode
    ? (db.prepare('SELECT id FROM users WHERE invite_code=?').get(inviteCode.toUpperCase()) as { id: number } | undefined)
    : undefined
  const r = db.prepare('INSERT INTO users(phone,nickname,invite_code,invited_by,created_at) VALUES(?,?,?,?,?)')
    .run(phone, phone.startsWith('guest:') ? 'Гость' : `Гость ${phone.slice(-4)}`, randomBytes(4).toString('hex').toUpperCase(), inviter?.id ?? null, Date.now())
  const userId = Number(r.lastInsertRowid)
  ensureCard(userId)
  grantVoucher(userId, 'WELCOME')
  return userId
})

export function verifyCodeAndLogin(input: { phone: string; code: string; inviteCode?: string }): number {
  const phone = normalizePhone(input.phone)
  const row = db.prepare('SELECT code, expires_at, attempts FROM sms_codes WHERE phone=?')
    .get(phone) as { code: string; expires_at: number; attempts: number } | undefined

  if (!row) throw bad('Неверный или просроченный код')
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sms_codes WHERE phone=?').run(phone)
    throw bad('Код истёк. Запросите новый код.')
  }
  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    db.prepare('DELETE FROM sms_codes WHERE phone=?').run(phone)
    throw bad('Слишком много попыток. Запросите новый код.', 429)
  }

  const incoming = hashOtp(phone, input.code.trim())
  // Support legacy plaintext codes during transition
  const ok = row.code === incoming || row.code === input.code.trim()
  if (!ok) {
    db.prepare('UPDATE sms_codes SET attempts = attempts + 1 WHERE phone=?').run(phone)
    throw bad('Неверный или просроченный код')
  }
  db.prepare('DELETE FROM sms_codes WHERE phone=?').run(phone)

  const existing = db.prepare('SELECT id FROM users WHERE phone=?').get(phone) as { id: number } | undefined
  return existing?.id ?? registerUser(phone, input.inviteCode)
}

/** Карта без телефона и SMS: синтетический id вместо ПДн. */
export function createGuestUser(inviteCode?: string): number {
  const phone = `guest:${randomBytes(16).toString('hex')}`
  return registerUser(phone, inviteCode)
}
