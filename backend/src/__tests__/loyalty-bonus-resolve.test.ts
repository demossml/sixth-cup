/**
 * Resolve в бонусном режиме (LOYALTY_BONUS_MODE=1, дефолт):
 * gift выключен, кэшбэк можно списывать после идентификации (код, телефон, QR).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-bonus-resolve-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'
delete process.env.LOYALTY_BONUS_MODE // дефолт config = вкл

const { app } = await import('../app')
const { db } = await import('../db')
const { config } = await import('../config')
const { registerByPhone } = await import('../modules/loyalty/customers')

const H = (dev = 'dev-b') => ({
  'Content-Type': 'application/json',
  Authorization: 'proxy-secret',
  'X-Evotor-Store-Uuid': 'store-1',
  'X-Evotor-Device-UUID': dev,
})
const resolve = async (body: Record<string, unknown>, dev = 'dev-b') => {
  const r = await app.request('/api/devices/loyalty/resolve', { method: 'POST', headers: H(dev), body: JSON.stringify(body) })
  return { status: r.status, data: (await r.json()) as any }
}
const reservations = (userId: number) =>
  db
    .prepare('SELECT status, benefit_free, benefit_cb FROM loyalty_reservations WHERE card_id=(SELECT card_id FROM users WHERE id=?)')
    .all(userId) as { status: string; benefit_free: number; benefit_cb: number }[]

let seq = 0
const uniqPhone = () => `9${String(300000000 + ++seq).slice(0, 9)}`

async function customer(opts: { balanceKopecks?: number; paidTotal?: number } = {}) {
  const phone = uniqPhone()
  const { customer: c } = registerByPhone({ phone, pdConsent: true, pdConsentVersion: 'v1' })
  if (opts.balanceKopecks) db.prepare('UPDATE users SET cashback_balance=? WHERE id=?').run(opts.balanceKopecks, c.userId)
  if (opts.paidTotal) db.prepare('UPDATE cards SET paid_total=? WHERE user_id=?').run(opts.paidTotal, c.userId)
  return { ...c, phone }
}

describe('bonus mode включён по умолчанию', () => {
  it('config.loyaltyBonusMode = true без переменной окружения', () => {
    expect(config.loyaltyBonusMode).toBe(true)
  })
})

describe('resolve kind=code в bonus mode', () => {
  it('баланс и процент видны, подарок не резервируется, списание разрешено', async () => {
    const c = await customer({ balanceKopecks: 1500, paidTotal: 5 })
    const r = await resolve({ code: c.cardCode })

    expect(r.status).toBe(200)
    expect(r.data.kind).toBe('code')
    expect(r.data.balanceKopecks).toBe(1500)
    expect(r.data.cashback).toBe(1500)
    expect(r.data.effectiveEarnPercent).toBe(5)
    expect(r.data.freeStatus).toBe('NONE')
    expect(r.data.freeAvailable).toBe(0) // gift выключен в bonus mode
    expect(r.data.cashbackReserved).toBe(0)
    expect(r.data.reservationId).toBeNull()
    expect(r.data.canRedeem).toBe(true)
    expect(reservations(c.userId)).toEqual([])
  })

  it('нулевой баланс — списывать нечего, canRedeem=false', async () => {
    const c = await customer({ balanceKopecks: 0 })
    const r = await resolve({ code: c.cardCode })
    expect(r.data.canRedeem).toBe(false)
    expect(r.data.balanceKopecks).toBe(0)
  })

  it('индивидуальный процент отдаётся в resolve', async () => {
    const c = await customer({ balanceKopecks: 100 })
    db.prepare('UPDATE users SET bonus_percent_bps=750 WHERE id=?').run(c.userId)
    const r = await resolve({ code: c.cardCode })
    expect(r.data.effectiveEarnPercent).toBe(7.5)
  })
})

describe('resolve по телефону (без QR)', () => {
  it('находит клиента и разрешает списание при балансе', async () => {
    const c = await customer({ balanceKopecks: 2500 })
    const r = await resolve({ phone: c.phone })

    expect(r.status).toBe(200)
    expect(r.data.cardCode).toBe(c.cardCode)
    expect(r.data.balanceKopecks).toBe(2500)
    expect(r.data.canRedeem).toBe(true)
    expect(r.data.freeStatus).toBe('NONE')
  })

  it('неизвестный телефон → card_not_found', async () => {
    const r = await resolve({ phone: '9990000001' })
    expect(r.status).toBe(404)
    expect(r.data.error).toBe('card_not_found')
  })

  it('без code и phone — 400 от валидатора', async () => {
    const r = await resolve({})
    expect(r.status).toBe(400)
  })
})

describe('resolve QR в bonus mode', () => {
  it('резерв держит баланс под кэшбэк, но не подарок', async () => {
    const c = await customer({ balanceKopecks: 3000, paidTotal: 5 })
    const info = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${await jwt(c.userId)}` } })
    const proof = ((await info.json()) as any).card as string

    const r = await resolve({ code: proof })
    expect(r.status).toBe(200)
    expect(r.data.kind).toBe('token')
    expect(r.data.freeStatus).toBe('NONE')
    expect(r.data.freeAvailable).toBe(0)
    expect(r.data.canRedeem).toBe(true)
    expect(r.data.cashbackReserved).toBe(3000)
    expect(r.data.reservationId).toMatch(/^R-/)

    const rows = reservations(c.userId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'RESERVED', benefit_free: 0, benefit_cb: 3000 })
  })
})

/** JWT для проверки QR-профиля: берём через реальный guest-эндпоинт нельзя (создаст нового), поэтому подписываем напрямую. */
async function jwt(userId: number): Promise<string> {
  const { sign } = await import('hono/jwt')
  const ver = (db.prepare('SELECT token_version AS v FROM users WHERE id=?').get(userId) as { v: number }).v
  return sign({ sub: userId, ver, exp: Math.floor(Date.now() / 1000) + 3600 }, config.jwtSecret)
}
