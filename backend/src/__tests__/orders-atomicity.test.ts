/**
 * P0-03 — атомарность заказа и гонки при оплате.
 *
 *  • создание заказа пишется одной транзакцией (заголовок + состав + идемпотентность);
 *  • `markPaid` — условный UPDATE: оплатить отменённый заказ нельзя, повтор идемпотентен;
 *  • смена статуса не перезаписывает чужой переход (409 вместо «воскрешения» заказа).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-orders-atomic-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { ensurePreorderTables } = await import('../modules/orders/service')

const JSONH = { 'content-type': 'application/json' }
const H_ADMIN = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }

const STORE = 1
const PRODUCT = 951
const EVOTOR_STORE_UUID = 'evotor-store-atomic'
const PROXY = { Authorization: 'Bearer proxy-secret', 'X-Evotor-Store-Uuid': EVOTOR_STORE_UUID }

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`

async function guest(): Promise<string> {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: JSONH, body: '{}' })
  return ((await r.json()) as { token: string }).token
}

async function deviceToken(storeId: number): Promise<string> {
  const r = await app.request('/api/admin/devices', {
    method: 'POST', headers: H_ADMIN, body: JSON.stringify({ storeId, name: uniq('term') }),
  })
  const { enrollCode } = (await r.json()) as { enrollCode: string }
  const e = await app.request('/api/devices/enroll', { method: 'POST', headers: JSONH, body: JSON.stringify({ code: enrollCode }) })
  return ((await e.json()) as { deviceToken: string }).deviceToken
}

function createOrder(token: string, key?: string) {
  const headers: Record<string, string> = { ...JSONH, Authorization: `Bearer ${token}` }
  if (key) headers['Idempotency-Key'] = key
  return app.request('/api/orders', {
    method: 'POST', headers,
    body: JSON.stringify({ storeId: STORE, items: [{ productId: String(PRODUCT), quantity: 1 }] }),
  })
}

const setStatus = (id: string, status: string, headers: Record<string, string>) =>
  app.request(`/api/devices/orders/${id}/status`, {
    method: 'PATCH', headers: { ...JSONH, ...headers }, body: JSON.stringify({ status }),
  })

const markPaid = (id: string, headers: Record<string, string>) =>
  app.request(`/api/devices/orders/${id}/mark-paid`, {
    method: 'POST', headers: { ...JSONH, ...headers }, body: JSON.stringify({}),
  })

beforeEach(() => {
  ensurePreorderTables(db as never)
  db.prepare(`DELETE FROM app_settings WHERE key LIKE 'preorder%'`).run()
  db.prepare('DELETE FROM preorder_bans').run()
  db.prepare('DELETE FROM preorder_item_modifiers').run()
  db.prepare('DELETE FROM preorder_items').run()
  db.prepare('DELETE FROM preorders').run()
  const t = Date.now()
  db.prepare('INSERT OR REPLACE INTO stores(id,name,address) VALUES(?,?,?)').run(STORE, 'Тестовая', 'ул. Тест, 1')
  db.prepare('INSERT OR REPLACE INTO evotor_stores(store_uuid,name,local_store_id,updated_at) VALUES(?,?,?,?)')
    .run(EVOTOR_STORE_UUID, 'Тестовая (Эвотор)', STORE, t)
  db.prepare(
    `INSERT OR REPLACE INTO products(id,name,price,available,icon,counts_as_cup,recipe_seconds,sort_order,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(PRODUCT, 'Латте 300', 280, 1, 'Coffee', 1, 120, 1, t, t)
  db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid,enabled,updated_at) VALUES(?,?,?,?,?)')
    .run(PRODUCT, EVOTOR_STORE_UUID, 'evo-atomic', 1, t)
})

describe('создание заказа одной транзакцией', () => {
  it('заголовок и состав пишутся вместе: нет заказа без позиций', async () => {
    const token = await guest()
    const res = await createOrder(token)
    expect(res.status).toBe(200)
    const order = ((await res.json()) as { order: { id: string } }).order
    const header = db.prepare('SELECT id FROM preorders WHERE id=?').get(order.id)
    expect(header).toBeTruthy()
    const items = db.prepare('SELECT COUNT(*) AS n FROM preorder_items WHERE order_id=?').get(order.id) as { n: number }
    expect(items.n).toBe(1)
  })

  it('повтор с тем же Idempotency-Key не создаёт второй заказ', async () => {
    const token = await guest()
    const key = uniq('idem')
    const a = await createOrder(token, key)
    const b = await createOrder(token, key)
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    const ida = ((await a.json()) as { order: { id: string } }).order.id
    const idb = ((await b.json()) as { order: { id: string } }).order.id
    expect(idb).toBe(ida)
    const rows = db.prepare('SELECT COUNT(*) AS n FROM preorders WHERE guest_user_id IS NOT NULL').get() as { n: number }
    expect(rows.n).toBe(1)
  })
})

describe('оплата заказа', () => {
  it('mark-paid идемпотентен: повтор не переписывает paid_at', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const id = ((await (await createOrder(g)).json()) as { order: { id: string } }).order.id
    expect((await setStatus(id, 'accepted', { 'X-Device-Token': dev })).status).toBe(200)

    const first = await markPaid(id, { 'X-Device-Token': dev })
    expect(first.status).toBe(200)
    const paidAt = (db.prepare('SELECT paid_at FROM preorders WHERE id=?').get(id) as { paid_at: number }).paid_at

    const second = await markPaid(id, { 'X-Device-Token': dev })
    expect(second.status).toBe(200)
    const paidAtAgain = (db.prepare('SELECT paid_at FROM preorders WHERE id=?').get(id) as { paid_at: number }).paid_at
    expect(paidAtAgain).toBe(paidAt)
  })

  it('оплатить отменённый заказ нельзя — 409 и статус не меняется', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const id = ((await (await createOrder(g)).json()) as { order: { id: string } }).order.id
    const cancel = await app.request(`/api/orders/${id}/cancel`, {
      method: 'POST', headers: { ...JSONH, Authorization: `Bearer ${g}` }, body: '{}',
    })
    expect(cancel.status).toBe(200)

    const res = await markPaid(id, { 'X-Device-Token': dev })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_transition')
    const row = db.prepare('SELECT status FROM preorders WHERE id=?').get(id) as { status: string }
    expect(row.status).toBe('cancelled')
  })

  it('черновик оплатить нельзя', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const id = ((await (await createOrder(g)).json()) as { order: { id: string } }).order.id
    expect((await markPaid(id, { 'X-Device-Token': dev })).status).toBe(409)
  })
})

describe('переходы статусов', () => {
  it('повтор «готов» не падает, а переход из оплаченного — 409', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const id = ((await (await createOrder(g)).json()) as { order: { id: string } }).order.id
    expect((await setStatus(id, 'accepted', { 'X-Device-Token': dev })).status).toBe(200)
    expect((await setStatus(id, 'ready', { 'X-Device-Token': dev })).status).toBe(200)
    // Идемпотентный повтор того же перехода.
    expect((await setStatus(id, 'ready', { 'X-Device-Token': dev })).status).toBe(200)

    expect((await markPaid(id, { 'X-Device-Token': dev })).status).toBe(200)
    // Из paid назад в кухню — нельзя.
    const back = await setStatus(id, 'cooking', { 'X-Device-Token': dev })
    expect(back.status).toBe(409)
    const row = db.prepare('SELECT status FROM preorders WHERE id=?').get(id) as { status: string }
    expect(row.status).toBe('paid')
  })

  it('отклонённый заказ нельзя вернуть в работу', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const id = ((await (await createOrder(g)).json()) as { order: { id: string } }).order.id
    expect((await setStatus(id, 'accepted', { 'X-Device-Token': dev })).status).toBe(200)
    const rej = await app.request(`/api/devices/orders/${id}/reject`, {
      method: 'POST', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ reason: 'нет молока' }),
    })
    expect(rej.status).toBe(200)
    const back = await setStatus(id, 'ready', { 'X-Device-Token': dev })
    expect(back.status).toBe(409)
    const row = db.prepare('SELECT status FROM preorders WHERE id=?').get(id) as { status: string }
    expect(row.status).toBe('rejected')
  })
})
