import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-vch-resolve-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { config } = await import('../config')
const { todayDay } = await import('../modules/vouchers/service')

const proxy = (dev: string) => ({
  'Content-Type': 'application/json',
  Authorization: 'proxy-secret',
  'X-Evotor-Store-Uuid': 'store-1',
  'X-Evotor-Device-UUID': dev,
})

async function guest(): Promise<{ jwt: string; card: { card: string; cardCode: string } }> {
  const r = await app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const { token } = (await r.json()) as { token: string }
  const c = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  return { jwt: token, card: (await c.json()) as { card: string; cardCode: string } }
}

const resolve = async (dev: string, code: string) => {
  const r = await app.request('/api/devices/loyalty/resolve', {
    method: 'POST',
    headers: proxy(dev),
    body: JSON.stringify({ code }),
  })
  return { status: r.status, data: (await r.json()) as any }
}

const userIdOf = (cardCode: string): number =>
  (db.prepare('SELECT id FROM users WHERE card_code=?').get(cardCode) as { id: number }).id

function templateId(): number {
  db.prepare(
    "INSERT OR IGNORE INTO voucher_templates(code,title,kind,value,valid_days) VALUES('WELCOME','Скидка 10%','percent',10,30)",
  ).run()
  return (db.prepare("SELECT id FROM voucher_templates WHERE code='WELCOME'").get() as { id: number }).id
}

function give(userId: number, opts: { title?: string; kind?: 'percent' | 'fixed'; value?: number; expiresDay?: number; usedAt?: number | null } = {}): number {
  const info = db
    .prepare('INSERT INTO vouchers(user_id,template_id,title,kind,value,expires_day,used_at) VALUES(?,?,?,?,?,?,?)')
    .run(
      userId,
      templateId(),
      opts.title ?? 'Скидка 10%',
      opts.kind ?? 'percent',
      opts.value ?? 10,
      opts.expiresDay ?? todayDay() + 10,
      opts.usedAt ?? null,
    )
  return Number(info.lastInsertRowid)
}

const reservedIds = (opId: string): string | null =>
  (db.prepare('SELECT benefit_voucher_ids AS v FROM loyalty_reservations WHERE id=?').get(opId) as { v: string | null }).v

beforeEach(() => {
  config.vouchersInResolve = false
})

afterAll(() => {
  config.vouchersInResolve = false
})

describe('STEP-V05: resolve отдаёт ваучеры за флагом', () => {
  it('флаг выключен: ваучеры не отдаются и не записываются в резерв', async () => {
    const g = await guest()
    const uid = userIdOf(g.card.cardCode)
    give(uid)
    const r = await resolve('dev-A', g.card.card)
    expect(r.status).toBe(200)
    expect(r.data.vouchers).toEqual([])
    expect(reservedIds(r.data.reservationId)).toBe('[]')
  })

  it('флаг включён: ваучер в ответе и id в резерве', async () => {
    config.vouchersInResolve = true
    const g = await guest()
    const uid = userIdOf(g.card.cardCode)
    const id = give(uid, { expiresDay: todayDay() + 5 })
    const r = await resolve('dev-A', g.card.card)
    expect(r.data.vouchers).toEqual([
      {
        id,
        title: 'Скидка 10%',
        kind: 'percent',
        value: 10,
        redemptionMode: 'once',
        stackableWithFreeCup: false,
        expiresDay: todayDay() + 5,
        imageUrl: null,
      },
    ])
    expect(JSON.parse(reservedIds(r.data.reservationId)!)).toEqual([id])
  })

  it('числовой код: ваучеров нет и резерва нет даже при включённом флаге', async () => {
    config.vouchersInResolve = true
    const g = await guest()
    give(userIdOf(g.card.cardCode))
    const r = await resolve('dev-A', g.card.cardCode)
    expect(r.data.kind).toBe('code')
    expect(r.data.vouchers).toEqual([])
    expect(r.data.reservationId).toBeNull()
  })

  it('чужая касса на активном резерве: ALREADY_RESERVED без ваучеров', async () => {
    config.vouchersInResolve = true
    const g = await guest()
    give(userIdOf(g.card.cardCode))
    const a = await resolve('dev-A', g.card.card)
    expect(a.data.vouchers).toHaveLength(1)
    const b = await resolve('dev-B', g.card.card)
    expect(b.data.freeStatus).toBe('ALREADY_RESERVED')
    expect(b.data.vouchers).toEqual([])
    expect(b.data.reservationId).toBeNull()
  })

  it('продление своим сканом подхватывает ваучер, выданный после резерва', async () => {
    config.vouchersInResolve = true
    const g = await guest()
    const uid = userIdOf(g.card.cardCode)
    const a = await resolve('dev-A', g.card.card)
    expect(a.data.vouchers).toEqual([])
    const id = give(uid)
    const a2 = await resolve('dev-A', g.card.card)
    expect(a2.data.reservationId).toBe(a.data.reservationId)
    expect(a2.data.vouchers.map((v: any) => v.id)).toEqual([id])
    expect(JSON.parse(reservedIds(a.data.reservationId)!)).toEqual([id])
  })

  it('использованный и просроченный не отдаются', async () => {
    config.vouchersInResolve = true
    const g = await guest()
    const uid = userIdOf(g.card.cardCode)
    give(uid, { usedAt: Date.now() })
    give(uid, { expiresDay: todayDay() - 1 })
    const r = await resolve('dev-A', g.card.card)
    expect(r.data.vouchers).toEqual([])
  })

  it('не больше maxVouchersInResolve', async () => {
    config.vouchersInResolve = true
    const g = await guest()
    const uid = userIdOf(g.card.cardCode)
    for (let i = 0; i < 12; i++) give(uid, { expiresDay: todayDay() + 1 + i })
    const r = await resolve('dev-A', g.card.card)
    expect(r.data.vouchers).toHaveLength(config.maxVouchersInResolve)
  })

  it('прежние поля ответа на месте', async () => {
    const g = await guest()
    const r = await resolve('dev-A', g.card.card)
    expect(r.data).toMatchObject({
      ok: true,
      cardCode: g.card.cardCode,
      kind: 'token',
      paidCups: 0,
      cupsForFree: config.cupsForFree,
      freeAvailable: 0,
      cashback: 0,
      cashbackReserved: 0,
      freeStatus: 'NONE',
    })
    expect(typeof r.data.reservationId).toBe('string')
    expect(typeof r.data.reservationExpiresAt).toBe('number')
    expect(Array.isArray(r.data.vouchers)).toBe(true)
  })
})
