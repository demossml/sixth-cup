/**
 * P0-02 — номера карт и списание по номеру.
 *
 *  • код выдаётся CSPRNG (10 цифр), а не `MAX+1`;
 *  • старые короткие коды продолжают работать как идентификатор;
 *  • перебор кодов упирается в лимит по самому номеру карты.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-card-security-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'
delete process.env.LOYALTY_BONUS_MODE

const { app } = await import('../app')
const { db } = await import('../db')
const { registerByPhone } = await import('../modules/loyalty/customers')

const H = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer proxy-secret',
  'X-Evotor-Store-Uuid': 'store-1',
  'X-Evotor-Device-UUID': 'dev-sec',
}

const resolve = async (body: Record<string, unknown>) => {
  const r = await app.request('/api/devices/loyalty/resolve', {
    method: 'POST', headers: H, body: JSON.stringify(body),
  })
  return { status: r.status, data: (await r.json()) as any }
}

let seq = 0
const uniqPhone = () => `9${String(400000000 + ++seq).slice(0, 9)}`

function newCustomer() {
  const phone = uniqPhone()
  const { customer } = registerByPhone({ phone, pdConsent: true, pdConsentVersion: 'v1' })
  return { ...customer, phone }
}

describe('генерация номеров карт', () => {
  it('код — 10 цифр и не идёт подряд (не MAX+1)', () => {
    const codes = Array.from({ length: 6 }, () => newCustomer().cardCode)
    for (const code of codes) expect(code).toMatch(/^\d{10}$/)
    expect(new Set(codes).size).toBe(codes.length)
    const numeric = codes.map(Number).sort((a, b) => a - b)
    const gaps = numeric.slice(1).map((n, i) => n - numeric[i]!)
    expect(gaps.some((g) => g !== 1)).toBe(true)
  })

  it('старый короткий код по-прежнему идентифицирует клиента', async () => {
    const c = newCustomer()
    db.prepare('UPDATE users SET card_code=? WHERE id=?').run('12', c.userId)
    const r = await resolve({ code: '12' })
    expect(r.status).toBe(200)
    expect(r.data.cardCode).toBe('12')
    expect(r.data.kind).toBe('code')
    expect(r.data.canRedeem).toBe(false)
  })
})

describe('перебор номеров карт', () => {
  it('после 5 промахов по одному коду — 429 card_locked', async () => {
    const unknown = '1234509876'
    for (let i = 0; i < 5; i += 1) {
      const r = await resolve({ code: unknown })
      expect(r.status).toBe(404)
      expect(r.data.error).toBe('card_not_found')
    }
    const locked = await resolve({ code: unknown })
    expect(locked.status).toBe(429)
    expect(locked.data.error).toBe('card_locked')
  })

  it('лимит не мешает другим кодам: чужой номер работает сразу', async () => {
    const c = newCustomer()
    const r = await resolve({ code: c.cardCode })
    expect(r.status).toBe(200)
    expect(r.data.cardCode).toBe(c.cardCode)
  })
})
