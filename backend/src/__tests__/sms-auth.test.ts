import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-sms-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.SMS_PROVIDER = 'mock'
process.env.JWT_SECRET = 'test-jwt-secret-for-hash'

const { app } = await import('../app')
const { seedIfEmpty } = await import('../db/seed')
const { db } = await import('../db')
const { getMockLastMessage } = await import('../lib/sms')
const { normalizePhone } = await import('../lib/phone')

seedIfEmpty()

async function json(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

describe('phone normalize', () => {
  it('normalizes 8 and 10 digit', () => {
    expect(normalizePhone('89991234567')).toBe('+79991234567')
    expect(normalizePhone('+7 999 123-45-67')).toBe('+79991234567')
    expect(normalizePhone('9991234567')).toBe('+79991234567')
  })
})

describe('OTP mock flow', () => {
  it('send-code stores hashed otp and mock message', async () => {
    const phone = '+79001110001'
    const r = await json('POST', '/api/auth/send-code', { phone })
    expect(r.status).toBe(200)
    expect(r.data.ok).toBe(true)
    expect(r.data.devCode).toMatch(/^\d{4}$/)

    const row = db.prepare('SELECT code FROM sms_codes WHERE phone=?').get(normalizePhone(phone)) as { code: string }
    expect(row.code).not.toBe(r.data.devCode)
    expect(row.code.length).toBe(64)

    const msg = getMockLastMessage(normalizePhone(phone))
    expect(msg).toContain(r.data.devCode)
  })

  it('verify correct code returns jwt', async () => {
    const phone = '+79001110002'
    const s = await json('POST', '/api/auth/send-code', { phone })
    const v = await json('POST', '/api/auth/verify', { phone, code: s.data.devCode })
    expect(v.status).toBe(200)
    expect(v.data.token).toBeTruthy()
  })

  it('rejects wrong code', async () => {
    const phone = '+79001110003'
    await json('POST', '/api/auth/send-code', { phone })
    const v = await json('POST', '/api/auth/verify', { phone, code: '0000' })
    expect(v.status).toBeGreaterThanOrEqual(400)
  })

  it('rejects reused code', async () => {
    const phone = '+79001110004'
    const s = await json('POST', '/api/auth/send-code', { phone })
    const code = s.data.devCode
    await json('POST', '/api/auth/verify', { phone, code })
    const again = await json('POST', '/api/auth/verify', { phone, code })
    expect(again.status).toBeGreaterThanOrEqual(400)
  })
})

afterAll(() => {
  try { db.close() } catch { /* */ }
  rmSync(dir, { recursive: true, force: true })
})
