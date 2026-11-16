/**
 * BONUS-LOYALTY, STEP-6: админ-API настроек процента и карточки клиента.
 * Токены: `test-admin` = owner, `test-viewer` = viewer (только чтение).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-bonus-admin-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.ADMIN_VIEWER_TOKEN = 'test-viewer'
process.env.NODE_ENV = 'development'
process.env.LOYALTY_BONUS_MODE = '1'

const { app } = await import('../app')
const { db } = await import('../db')
const { setGlobalEarnBps } = await import('../modules/loyalty/settings')

const admin = { 'Content-Type': 'application/json', 'X-Admin-Token': 'test-admin' }
const viewer = { 'Content-Type': 'application/json', 'X-Admin-Token': 'test-viewer' }

let uid = 0
let seq = 0

beforeEach(async () => {
  setGlobalEarnBps(db, 500, 'test')
  const r = await app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const { token } = (await r.json()) as { token: string }
  await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  uid = (db.prepare('SELECT user_id AS id FROM cards ORDER BY user_id DESC LIMIT 1').get() as { id: number }).id
  seq += 1
  db.prepare("UPDATE users SET phone=?, nickname=?, cashback_balance=?, bonus_percent_bps=NULL WHERE id=?").run(
    `799912345${String(seq).padStart(2, '0')}`,
    `Гость ${seq}`,
    12345,
    uid,
  )
  const cardId = (db.prepare('SELECT card_id AS c FROM users WHERE id=?').get(uid) as { c: string }).c
  db.prepare(
    `INSERT INTO loyalty_ledger(card_id,operation,cups_delta,free_delta,cashback_delta,source_type,source_id,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(cardId, 'EARN', 0, 0, 12345, 'EVOTOR_BONUS_EARN', `seed-${seq}`, Date.now())
})

describe('GET/PUT /api/admin/loyalty/settings', () => {
  it('отдаёт глобальный процент по умолчанию', async () => {
    const r = await app.request('/api/admin/loyalty/settings', { headers: admin })
    expect(r.status).toBe(200)
    const body = (await r.json()) as any
    expect(body.settings).toMatchObject({ earnPercent: 5, earnBps: 500, maxPercent: 100, bonusMode: true })
  })

  it('меняет процент и пишет аудит', async () => {
    const r = await app.request('/api/admin/loyalty/settings', {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ earnPercent: 7.5 }),
    })
    expect(r.status).toBe(200)
    const body = (await r.json()) as any
    expect(body.settings).toMatchObject({ earnPercent: 7.5, earnBps: 750 })
    const again = (await (await app.request('/api/admin/loyalty/settings', { headers: admin })).json()) as any
    expect(again.settings.earnBps).toBe(750)
    expect(db.prepare("SELECT 1 FROM admin_audit WHERE entity='loyalty-settings'").get()).toBeTruthy()
  })

  it('отклоняет процент вне 0–100', async () => {
    const r = await app.request('/api/admin/loyalty/settings', {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ earnPercent: 150 }),
    })
    expect(r.status).toBe(400)
  })

  it('viewer не может менять настройку, но может читать', async () => {
    expect((await app.request('/api/admin/loyalty/settings', { headers: viewer })).status).toBe(200)
    const r = await app.request('/api/admin/loyalty/settings', {
      method: 'PUT',
      headers: viewer,
      body: JSON.stringify({ earnPercent: 3 }),
    })
    expect(r.status).toBe(403)
  })
})

describe('карточка клиента: процент, маска телефона, ledger', () => {
  it('находит клиента по телефону в любом формате', async () => {
    const phone = `+7 999 123-45-${String(seq).padStart(2, '0')}`
    const r = await app.request(`/api/admin/customers?query=${encodeURIComponent(phone)}`, { headers: admin })
    expect(r.status).toBe(200)
    const body = (await r.json()) as any
    expect(body.customers.map((c: any) => c.id)).toContain(uid)
    const mine = body.customers.find((c: any) => c.id === uid)
    expect(mine).toMatchObject({ bonusPercent: null, effectivePercent: 5 })
  })

  it('карточка отдаёт баланс, эффективный процент и маску, но не сырой телефон', async () => {
    const r = await app.request(`/api/admin/customers/${uid}`, { headers: admin })
    expect(r.status).toBe(200)
    const body = (await r.json()) as any
    expect(body.user).not.toHaveProperty('phone')
    expect(body).toMatchObject({
      bonusPercent: null,
      effectivePercent: 5,
      earnSource: 'global',
      phoneMasked: `+7 ••• ••• 45 ${String(seq).padStart(2, '0')}`,
    })
    expect(body.user.cashbackBalance).toBe(12345)
  })

  it('ставит индивидуальный процент, пишет bonus_percent_audit и сбрасывает к глобальному', async () => {
    const put = await app.request(`/api/admin/customers/${uid}/bonus-percent`, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ percent: 10 }),
    })
    expect(put.status).toBe(200)
    expect((await put.json()) as any).toMatchObject({ bonusPercent: 10, effectivePercent: 10, earnSource: 'individual' })

    const reset = await app.request(`/api/admin/customers/${uid}/bonus-percent`, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ percent: null }),
    })
    expect(reset.status).toBe(200)
    expect((await reset.json()) as any).toMatchObject({ bonusPercent: null, effectivePercent: 5, earnSource: 'global' })

    const rows = db.prepare('SELECT old_bps AS oldBps, new_bps AS newBps FROM bonus_percent_audit WHERE user_id=? ORDER BY id').all(uid)
    expect(rows).toEqual([{ oldBps: null, newBps: 1000 }, { oldBps: 1000, newBps: null }])
  })

  it('viewer не может менять индивидуальный процент', async () => {
    const r = await app.request(`/api/admin/customers/${uid}/bonus-percent`, {
      method: 'PUT',
      headers: viewer,
      body: JSON.stringify({ percent: 10 }),
    })
    expect(r.status).toBe(403)
  })

  it('ledger отдаёт баланс и последние движения', async () => {
    const r = await app.request(`/api/admin/customers/${uid}/ledger`, { headers: admin })
    expect(r.status).toBe(200)
    const body = (await r.json()) as any
    expect(body.balanceKopecks).toBe(12345)
    expect(body.movements[0]).toMatchObject({ operation: 'EARN', cashbackDelta: 12345, sourceType: 'EVOTOR_BONUS_EARN' })
  })
})
