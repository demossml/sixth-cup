/**
 * Кассовый API: поиск и регистрация клиента по телефону (BONUS-LOYALTY, вариант B).
 * Проверяем proxy-контур (как resolve), согласие на ПД и идемпотентность регистрации.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-bonus-device-cust-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')

const headers = (dev = 'dev-cust') => ({
  'Content-Type': 'application/json',
  Authorization: 'proxy-secret',
  'X-Evotor-Store-Uuid': 'store-1',
  'X-Evotor-Device-UUID': dev,
})

const post = async (path: string, body: unknown, dev?: string) => {
  const r = await app.request(`/api/devices${path}`, { method: 'POST', headers: headers(dev), body: JSON.stringify(body) })
  return { status: r.status, body: (await r.json()) as any }
}

let seq = 0
const uniqPhone = () => `9${String(200000000 + ++seq).slice(0, 9)}`

describe('POST /api/devices/customers/lookup', () => {
  it('без proxy-токена — 403', async () => {
    const r = await app.request('/api/devices/customers/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9991234567' }),
    })
    expect(r.status).toBe(403)
  })

  it('неизвестный номер → found:false, а не 404', async () => {
    const r = await post('/customers/lookup', { phone: uniqPhone() })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, found: false })
  })

  it('мусор вместо телефона → 400', async () => {
    const r = await post('/customers/lookup', { phone: '12' })
    expect(r.status).toBe(400)
  })

  it('находит зарегистрированного клиента и отдаёт баланс с процентом', async () => {
    const phone = uniqPhone()
    const reg = await post('/customers/register', { phone, pdConsent: true, pdConsentVersion: 'v1' })
    expect(reg.body.created).toBe(true)

    const found = await post('/customers/lookup', { phone: `+7 ${phone.slice(0, 3)} ${phone.slice(3)}` })
    expect(found.status).toBe(200)
    expect(found.body.found).toBe(true)
    expect(found.body.userId).toBe(reg.body.userId)
    expect(found.body.cardCode).toBe(reg.body.cardCode)
    expect(found.body.balanceKopecks).toBe(0)
    expect(found.body.effectiveEarnPercent).toBe(5)
    expect(found.body.earnSource).toBe('global')
    expect(found.body.phoneMasked).toMatch(/^\+7 ••• ••• \d\d \d\d$/)
    expect(JSON.stringify(found.body)).not.toContain(phone) // полный номер не утекает
  })
})

describe('POST /api/devices/customers/register', () => {
  it('без согласия → 400 и пользователь не создаётся', async () => {
    const phone = uniqPhone()
    const r = await post('/customers/register', { phone, pdConsent: false, pdConsentVersion: 'v1' })
    expect(r.status).toBe(400)
    const n = db.prepare('SELECT COUNT(*) AS n FROM users WHERE phone=?').get(`7${phone}`) as { n: number }
    expect(n.n).toBe(0)
  })

  it('без версии согласия → 400', async () => {
    const r = await post('/customers/register', { phone: uniqPhone(), pdConsent: true })
    expect(r.status).toBe(400)
  })

  it('повторная регистрация того же номера не создаёт дубль', async () => {
    const phone = uniqPhone()
    const a = await post('/customers/register', { phone, pdConsent: true, pdConsentVersion: 'v1' })
    const b = await post('/customers/register', { phone, pdConsent: true, pdConsentVersion: 'v1' }, 'dev-other')
    expect(a.body.created).toBe(true)
    expect(b.body.created).toBe(false)
    expect(b.body.userId).toBe(a.body.userId)
    expect(b.body.cardCode).toBe(a.body.cardCode)
    const n = db.prepare('SELECT COUNT(*) AS n FROM users WHERE phone=?').get(`7${phone}`) as { n: number }
    expect(n.n).toBe(1)
  })

  it('индивидуальный процент виден в ответе регистрации', async () => {
    const phone = uniqPhone()
    const reg = await post('/customers/register', { phone, pdConsent: true, pdConsentVersion: 'v1' })
    db.prepare('UPDATE users SET bonus_percent_bps=700 WHERE id=?').run(reg.body.userId)
    const found = await post('/customers/lookup', { phone })
    expect(found.body.effectiveEarnPercent).toBe(7)
    expect(found.body.earnSource).toBe('individual')
  })
})
