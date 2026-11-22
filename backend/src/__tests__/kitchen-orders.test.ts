/**
 * STEP-4..8: очередь бариста — создание с кассы (идемпотентно), экран бариста, статусы для кассы.
 *
 * Касса ходит как остальные device-запросы: прокси-токен Эвотора + X-Evotor-Store-Uuid.
 * Бариста — staff JWT из /api/staff/login.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-kitchen-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { createAppUser } = await import('../modules/staff/appUsers')

const H_ADMIN = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
const JSONH = { 'content-type': 'application/json' }
const PROXY = 'Bearer proxy-secret'
const STORE_A = 'store-a-1111'
const STORE_B = 'store-b-2222'

async function mkStore(name: string, storeUuid: string): Promise<void> {
  const r = await app.request('/api/admin/stores', {
    method: 'POST',
    headers: H_ADMIN,
    body: JSON.stringify({ name, address: 'адрес' }),
  })
  const body = (await r.json()) as { store?: { id: number }; id?: number }
  const storeId = Number(body.store?.id ?? body.id)
  db.prepare('INSERT INTO evotor_stores(store_uuid, name, address, local_store_id) VALUES(?,?,?,?)')
    .run(storeUuid, name, 'адрес', storeId)
}

function deviceHeaders(storeUuid: string) {
  return { ...JSONH, Authorization: PROXY, 'X-Evotor-Store-Uuid': storeUuid }
}

async function staffToken(login: string, storeUuid: string | null, role: 'barista' | 'owner' = 'barista') {
  await createAppUser({ login, password: 'secret123', role, storeUuid })
  const res = await app.request('/api/staff/login', {
    method: 'POST',
    headers: JSONH,
    body: JSON.stringify({ login, password: 'secret123' }),
  })
  const body = (await res.json()) as { token: string }
  return body.token
}

type Created = { id: string; queueNumber: number; status: string; createdAt: number }

async function createOrder(storeUuid: string, clientOrderId: string, extra: Record<string, unknown> = {}) {
  return app.request('/api/devices/kitchen/orders', {
    method: 'POST',
    headers: deviceHeaders(storeUuid),
    body: JSON.stringify({
      clientOrderId,
      storeUuid,
      items: [{ name: 'Капучино 350', qty: 1, mods: ['Овсяное', 'Ваниль'], note: null }],
      totalKopecks: 25000,
      ...extra,
    }),
  })
}

const staffGet = (token: string, status = 'active') =>
  app.request(`/api/staff/kitchen/orders?status=${status}`, { headers: { Authorization: `Bearer ${token}` } })

const staffPost = (token: string, path: string) =>
  app.request(`/api/staff/kitchen${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

beforeEach(async () => {
  db.prepare('DELETE FROM kitchen_orders').run()
  db.prepare('DELETE FROM queue_numbers').run()
  db.prepare('DELETE FROM queue_counters').run()
  db.prepare('DELETE FROM app_users').run()
  db.prepare('DELETE FROM evotor_stores').run()
  db.prepare('DELETE FROM rate_limits').run()
  await mkStore('Точка A', STORE_A)
  await mkStore('Точка B', STORE_B)
})

describe('POST /api/devices/kitchen/orders', () => {
  it('создаёт заказ со статусом new и номером очереди', async () => {
    const res = await createOrder(STORE_A, 'cart-1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Created
    expect(body.id).toMatch(/[0-9a-f-]{36}/)
    expect(body.status).toBe('new')
    expect(body.queueNumber).toBe(1)
    expect(typeof body.createdAt).toBe('number')
  })

  it('повтор с тем же clientOrderId не создаёт второй заказ и не тратит номер', async () => {
    const first = (await (await createOrder(STORE_A, 'cart-dup')).json()) as Created
    const second = (await (await createOrder(STORE_A, 'cart-dup')).json()) as Created
    expect(second.id).toBe(first.id)
    expect(second.queueNumber).toBe(first.queueNumber)
    expect(db.prepare('SELECT COUNT(*) AS n FROM kitchen_orders').get()).toEqual({ n: 1 })
  })

  it('тот же clientOrderId на другой точке — отдельный заказ', async () => {
    const a = (await (await createOrder(STORE_A, 'cart-shared')).json()) as Created
    const b = (await (await createOrder(STORE_B, 'cart-shared')).json()) as Created
    expect(b.id).not.toBe(a.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM kitchen_orders').get()).toEqual({ n: 2 })
  })

  it('пустой состав → 400', async () => {
    const res = await createOrder(STORE_A, 'cart-empty', { items: [] })
    expect(res.status).toBe(400)
  })

  it('подмена точки в теле → 400', async () => {
    const res = await createOrder(STORE_A, 'cart-swap', { storeUuid: STORE_B })
    expect(res.status).toBe(400)
  })

  it('без credential кассы → 401', async () => {
    const res = await app.request('/api/devices/kitchen/orders', {
      method: 'POST',
      headers: { ...JSONH, 'X-Evotor-Store-Uuid': STORE_A },
      body: JSON.stringify({ clientOrderId: 'no-auth', items: [{ name: 'X', qty: 1 }] }),
    })
    expect(res.status).toBe(401)
  })

  it('переиспользует номер, выданный кассе заранее (queueOrderId)', async () => {
    const q = await app.request('/api/devices/queue-number', {
      method: 'POST',
      headers: deviceHeaders(STORE_A),
      body: JSON.stringify({ orderId: 'cart-pre' }),
    })
    const qb = (await q.json()) as { publicOrderNumber: string }
    const created = (await (await createOrder(STORE_A, 'cart-pre', { queueOrderId: 'cart-pre' })).json()) as Created
    expect(String(created.queueNumber)).toBe(qb.publicOrderNumber)
  })
})

describe('Экран бариста', () => {
  it('бариста видит new своей точки, тап → seen, «Исполнен» → done один раз', async () => {
    const created = (await (await createOrder(STORE_A, 'cart-flow')).json()) as Created
    const token = await staffToken('barista-a', STORE_A)

    const list = (await (await staffGet(token)).json()) as { orders: { id: string; status: string; items: unknown[] }[] }
    expect(list.orders).toHaveLength(1)
    expect(list.orders[0]).toMatchObject({ id: created.id, status: 'new' })

    const seen = (await (await staffPost(token, `/orders/${created.id}/seen`)).json()) as { order: { status: string; seenAt: number } }
    expect(seen.order.status).toBe('seen')
    expect(seen.order.seenAt).toBeGreaterThan(0)
    // Повторный тап не ошибка и не сдвигает время.
    const seenAgain = (await (await staffPost(token, `/orders/${created.id}/seen`)).json()) as { order: { seenAt: number } }
    expect(seenAgain.order.seenAt).toBe(seen.order.seenAt)

    const done = (await (await staffPost(token, `/orders/${created.id}/done`)).json()) as { changed: boolean; order: { status: string; doneAt: number } }
    expect(done.changed).toBe(true)
    expect(done.order.status).toBe('done')
    const doneAgain = (await (await staffPost(token, `/orders/${created.id}/done`)).json()) as { changed: boolean; order: { doneAt: number } }
    expect(doneAgain.changed).toBe(false)
    expect(doneAgain.order.doneAt).toBe(done.order.doneAt)

    const after = (await (await staffGet(token)).json()) as { orders: unknown[] }
    expect(after.orders).toHaveLength(0)
  })

  it('бариста другой точки не видит и не меняет заказ → 403', async () => {
    const created = (await (await createOrder(STORE_A, 'cart-other')).json()) as Created
    const tokenB = await staffToken('barista-b', STORE_B)

    const list = (await (await staffGet(tokenB)).json()) as { orders: unknown[] }
    expect(list.orders).toHaveLength(0)
    expect((await staffPost(tokenB, `/orders/${created.id}/seen`)).status).toBe(403)
    expect((await staffPost(tokenB, `/orders/${created.id}/done`)).status).toBe(403)
  })

  it('owner без точки видит заказы всех точек', async () => {
    await createOrder(STORE_A, 'cart-own-a')
    await createOrder(STORE_B, 'cart-own-b')
    const token = await staffToken('owner-1', null, 'owner')
    const list = (await (await staffGet(token)).json()) as { orders: unknown[] }
    expect(list.orders).toHaveLength(2)
  })

  it('без токена → 401', async () => {
    expect((await app.request('/api/staff/kitchen/orders')).status).toBe(401)
  })

  it('PATCH /api/staff/me сохраняет настройку моргания', async () => {
    const token = await staffToken('barista-blink', STORE_A)
    const res = await app.request('/api/staff/me', {
      method: 'PATCH',
      headers: { ...JSONH, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ alertBlink: false }),
    })
    expect(res.status).toBe(200)
    const me = (await (await app.request('/api/staff/me', { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      user: { alertBlink: boolean }
    }
    expect(me.user.alertBlink).toBe(false)
  })
})

describe('GET /api/devices/kitchen/orders (касса видит «готов»)', () => {
  it('после done заказ присутствует в списке точки', async () => {
    const created = (await (await createOrder(STORE_A, 'cart-status')).json()) as Created
    const token = await staffToken('barista-status', STORE_A)
    await staffPost(token, `/orders/${created.id}/done`)

    const res = await app.request('/api/devices/kitchen/orders', { headers: deviceHeaders(STORE_A) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { orders: { id: string; status: string }[] }
    expect(body.orders.find((o) => o.id === created.id)?.status).toBe('done')
  })
})
