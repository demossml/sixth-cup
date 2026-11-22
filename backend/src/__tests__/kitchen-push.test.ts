/**
 * STEP-7: push гостю при «Исполнен».
 * Модуль push подменяем: сеть наружу в тестах не нужна, проверяем сам факт и однократность отправки.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../modules/push/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/push/service')>()
  return { ...actual, pushToUser: vi.fn(async () => 1) }
})

const dir = mkdtempSync(join(tmpdir(), 'sc-kitchen-push-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { createAppUser } = await import('../modules/staff/appUsers')
const { pushToUser } = await import('../modules/push/service')

const JSONH = { 'content-type': 'application/json' }
const STORE = 'store-push-1'
const H_ADMIN = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }

beforeEach(async () => {
  vi.clearAllMocks()
  db.prepare('DELETE FROM kitchen_orders').run()
  db.prepare('DELETE FROM queue_numbers').run()
  db.prepare('DELETE FROM queue_counters').run()
  db.prepare('DELETE FROM app_users').run()
  db.prepare('DELETE FROM evotor_stores').run()
  const r = await app.request('/api/admin/stores', {
    method: 'POST',
    headers: H_ADMIN,
    body: JSON.stringify({ name: 'Точка', address: 'адрес' }),
  })
  const body = (await r.json()) as { store?: { id: number }; id?: number }
  db.prepare('INSERT INTO evotor_stores(store_uuid, name, address, local_store_id) VALUES(?,?,?,?)')
    .run(STORE, 'Точка', 'адрес', Number(body.store?.id ?? body.id))
})

async function setup() {
  await createAppUser({ login: 'barista-push', password: 'secret123', role: 'barista', storeUuid: STORE })
  const login = await app.request('/api/staff/login', {
    method: 'POST',
    headers: JSONH,
    body: JSON.stringify({ login: 'barista-push', password: 'secret123' }),
  })
  const { token } = (await login.json()) as { token: string }
  const created = await app.request('/api/devices/kitchen/orders', {
    method: 'POST',
    headers: { ...JSONH, Authorization: 'Bearer proxy-secret', 'X-Evotor-Store-Uuid': STORE },
    body: JSON.stringify({
      clientOrderId: 'push-cart',
      storeUuid: STORE,
      items: [{ name: 'Латте', qty: 1, mods: [], note: null }],
      guestUserId: 4242,
    }),
  })
  const order = (await created.json()) as { id: string; queueNumber: number }
  return { token, order }
}

describe('push при done', () => {
  it('отправляется один раз с номером очереди', async () => {
    const { token, order } = await setup()
    const done = (path: string) =>
      app.request(`/api/staff/kitchen${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

    expect((await done(`/orders/${order.id}/done`)).status).toBe(200)
    expect(pushToUser).toHaveBeenCalledTimes(1)
    const [userId, payload] = vi.mocked(pushToUser).mock.calls[0]
    expect(userId).toBe(4242)
    expect(payload.title).toContain(String(order.queueNumber))

    // Повторное «Исполнен» не дублирует уведомление.
    await done(`/orders/${order.id}/done`)
    expect(pushToUser).toHaveBeenCalledTimes(1)
  })

  it('заказ без guestUserId не шлёт push', async () => {
    await createAppUser({ login: 'barista-push2', password: 'secret123', role: 'barista', storeUuid: STORE })
    const login = await app.request('/api/staff/login', {
      method: 'POST',
      headers: JSONH,
      body: JSON.stringify({ login: 'barista-push2', password: 'secret123' }),
    })
    const { token } = (await login.json()) as { token: string }
    const created = await app.request('/api/devices/kitchen/orders', {
      method: 'POST',
      headers: { ...JSONH, Authorization: 'Bearer proxy-secret', 'X-Evotor-Store-Uuid': STORE },
      body: JSON.stringify({
        clientOrderId: 'push-cart-anon',
        storeUuid: STORE,
        items: [{ name: 'Эспрессо', qty: 1 }],
      }),
    })
    const order = (await created.json()) as { id: string }
    await app.request(`/api/staff/kitchen/orders/${order.id}/done`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(pushToUser).not.toHaveBeenCalled()
  })
})
