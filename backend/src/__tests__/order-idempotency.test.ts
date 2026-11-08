/**
 * P1-3: повтор запроса не создаёт второй заказ, а параллельные попытки не проходят гонку.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-idempotency-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')

const STORE = 31
const PRODUCT = 3101
const JSONH = { 'content-type': 'application/json' }

async function guest(): Promise<string> {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: JSONH, body: '{}' })
  return ((await r.json()) as { token: string }).token
}

const create = async (token: string, key?: string) =>
  app.request('/api/orders', {
    method: 'POST',
    headers: { ...JSONH, Authorization: 'Bearer ' + token, ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify({ storeId: STORE, items: [{ productId: String(PRODUCT), quantity: 1 }] }),
  })

beforeEach(() => {
  const t = Date.now()
  db.prepare(`INSERT OR REPLACE INTO stores(id,name,address) VALUES(?,?,?)`).run(STORE, 'Точка', 'ул. 1')
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,available,icon,counts_as_cup,sort_order,created_at,updated_at)
    VALUES(?,?,?,1,'Coffee',1,1,?,?)`).run(PRODUCT, 'Капучино', 300, t, t)
  db.prepare('DELETE FROM preorders').run()
  db.prepare('DELETE FROM idempotency_keys').run()
})

describe('P1-3 идемпотентность создания заказа', () => {
  it('тот же Idempotency-Key → тот же заказ', async () => {
    const g = await guest()
    const first = await create(g, 'key-1')
    expect(first.status).toBe(200)
    const id1 = ((await first.json()) as any).order.id

    const second = await create(g, 'key-1')
    expect(second.status).toBe(200)
    const id2 = ((await second.json()) as any).order.id
    expect(id2).toBe(id1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM preorders').get() as { n: number }).n).toBe(1)
  })

  it('разные ключи при активном заказе → 409 active_order_exists', async () => {
    const g = await guest()
    expect((await create(g, 'key-a')).status).toBe(200)
    const second = await create(g, 'key-b')
    expect(second.status).toBe(409)
    expect(((await second.json()) as any).error).toBe('active_order_exists')
  })

  it('параллельные запросы без ключей не создают два заказа', async () => {
    const g = await guest()
    const results = await Promise.all([create(g), create(g), create(g)])
    const statuses = results.map((r) => r.status).sort()
    // Один успех, остальные — 409: гонку закрывает уникальный индекс.
    expect(statuses[0]).toBe(200)
    expect(statuses.filter((s) => s === 409).length).toBeGreaterThanOrEqual(1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM preorders').get() as { n: number }).n).toBe(1)
  })

  it('ключ другого гостя не отдаёт чужой заказ', async () => {
    const g1 = await guest()
    const g2 = await guest()
    const first = await create(g1, 'shared-key')
    const id1 = ((await first.json()) as any).order.id
    const second = await create(g2, 'shared-key')
    // Чужой заказ не вернули: гостю 2 создаётся свой (или 409, если что-то активно).
    const body = (await second.json()) as any
    expect(body.order?.id).not.toBe(id1)
  })
})
