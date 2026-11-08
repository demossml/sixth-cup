/**
 * Экран «Заказы» на кассе: авторизация как у остальных device-запросов.
 *
 * APK не умеет enroll и не шлёт X-Device-Token: он ходит с X-Evotor-Store-Uuid,
 * а Authorization подставляет облако Эвотора. Требование только X-Device-Token давало
 * 401 «Терминал не авторизован. Перепривяжите кассу», хотя касса работает.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-device-orders-auth-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')

const H_ADMIN = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
const JSONH = { 'content-type': 'application/json' }
const STORE_UUID = '8f1c1a52-1111-4c4c-9c9c-000000000001'
const PROXY = { Authorization: 'Bearer proxy-secret' }

async function mkStore(name: string): Promise<number> {
  const r = await app.request('/api/admin/stores', { method: 'POST', headers: H_ADMIN, body: JSON.stringify({ name, address: 'адрес' }) })
  const body = (await r.json()) as { store?: { id: number }; id?: number }
  return Number(body.store?.id ?? body.id)
}

async function linkEvotor(storeId: number, storeUuid: string) {
  db.prepare(`INSERT INTO evotor_stores(store_uuid, name, address, local_store_id) VALUES(?,?,?,?)`)
    .run(storeUuid, 'Кофейня', 'адрес', storeId)
}

const active = (headers: Record<string, string>) => app.request('/api/devices/orders/active', { headers })

describe('авторизация кассы для экрана заказов', () => {
  beforeEach(() => {
    db.prepare("DELETE FROM evotor_stores").run()
  })

  it('X-Evotor-Store-Uuid + прокси → 200 (актуальный APK)', async () => {
    const storeId = await mkStore('Точка A')
    await linkEvotor(storeId, STORE_UUID)
    const res = await active({ ...PROXY, 'X-Evotor-Store-Uuid': STORE_UUID })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true)
  })

  it('без авторизации и при нескольких точках → 401', async () => {
    await mkStore('Точка 1')
    await mkStore('Точка 2')
    expect((await active({})).status).toBe(401)
  })

  it('неизвестный uuid точки → 404 unknown_store', async () => {
    await mkStore('Точка B')
    const res = await active({ ...PROXY, 'X-Evotor-Store-Uuid': 'ffffffff-2222-4c4c-9c9c-000000000009' })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe('unknown_store')
  })

  it('одноточечная установка: касса без кэша точки всё равно видит свои заказы', async () => {
    db.prepare('DELETE FROM stores').run()
    await mkStore('Единственная точка')
    expect((await active(PROXY)).status).toBe(200)
  })

  it('POST /orders/:id/status работает как PATCH (касса на Android не умеет PATCH)', async () => {
    const storeId = await mkStore('Точка E')
    await linkEvotor(storeId, STORE_UUID)
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`INSERT INTO preorders(id, short_code, store_id, status, estimate_total, currency, expires_at, created_at, updated_at)
      VALUES('o-status','222222',?,'draft',300,'RUB',?,?,?)`).run(storeId, now + 1800, now, now)
    const res = await app.request('/api/devices/orders/o-status/status', {
      method: 'POST',
      headers: { ...JSONH, ...PROXY, 'X-Evotor-Store-Uuid': STORE_UUID, 'X-HTTP-Method-Override': 'PATCH' },
      body: JSON.stringify({ status: 'accepted' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; order: { status: string } }
    expect(body.ok).toBe(true)
    expect(body.order.status).toBe('accepted')
  })

  it('PATCH /orders/:id/status тоже работает (новые сборки кассы)', async () => {
    const storeId = await mkStore('Точка F')
    await linkEvotor(storeId, STORE_UUID)
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`INSERT INTO preorders(id, short_code, store_id, status, estimate_total, currency, expires_at, created_at, updated_at)
      VALUES('o-patch','333333',?,'draft',300,'RUB',?,?,?)`).run(storeId, now + 1800, now, now)
    const res = await app.request('/api/devices/orders/o-patch/status', {
      method: 'PATCH',
      headers: { ...JSONH, ...PROXY, 'X-Evotor-Store-Uuid': STORE_UUID },
      body: JSON.stringify({ status: 'accepted' }),
    })
    expect(res.status).toBe(200)
  })

  it('чужой store-заголовок не открывает заказы другой точки', async () => {
    const a = await mkStore('Точка C')
    const b = await mkStore('Точка D')
    await linkEvotor(a, STORE_UUID)
    const other = '8f1c1a52-3333-4c4c-9c9c-000000000002'
    await linkEvotor(b, other)
    const own = await active({ ...PROXY, 'X-Evotor-Store-Uuid': STORE_UUID })
    expect(own.status).toBe(200)
    const foreign = await active({ ...PROXY, 'X-Evotor-Store-Uuid': other })
    expect(foreign.status).toBe(200)
    db.prepare(`INSERT INTO preorders(id, short_code, store_id, status, estimate_total, currency, expires_at, created_at, updated_at)
      VALUES('o-a','111111',?,'accepted',300,'RUB',?,?,?)`).run(a, Date.now() / 1000 + 600, Date.now() / 1000, Date.now() / 1000)
    const rows = (await (await active({ ...PROXY, 'X-Evotor-Store-Uuid': other })).json()) as { orders: unknown[] }
    expect(rows.orders).toHaveLength(0)
  })
})
