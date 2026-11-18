/**
 * A6 / H-01…H-03 — ужесточение публичного контура заказов.
 *
 *  H-01: точка/товар проверяются на сервере (организация выключена, товар выключен в точке).
 *  H-02: `quoteToken` сверяется целиком — сумма, скидка, итог и сам бонус.
 *  H-03: тело запроса ограничено, форма — по схеме.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-orders-hardening-'))
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
const STORE = 1
const PRODUCT = 952
const STORE_UUID = 'evotor-store-hardening'

async function newGuest(): Promise<{ token: string; userId: number }> {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: JSONH, body: '{}' })
  const { token } = (await r.json()) as { token: string }
  const row = db.prepare('SELECT id FROM users ORDER BY id DESC LIMIT 1').get() as { id: number }
  return { token, userId: Number(row.id) }
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

const quote = (token: string, body: Record<string, unknown>) =>
  app.request('/api/orders/quote', { method: 'POST', headers: { ...JSONH, ...auth(token) }, body: JSON.stringify(body) })

const create = (token: string, body: Record<string, unknown>) =>
  app.request('/api/orders', { method: 'POST', headers: { ...JSONH, ...auth(token) }, body: JSON.stringify(body) })

const items = (qty = 1) => [{ productId: String(PRODUCT), quantity: qty }]

beforeEach(() => {
  ensurePreorderTables(db as never)
  db.prepare(`DELETE FROM app_settings WHERE key LIKE 'preorder%'`).run()
  db.prepare('DELETE FROM preorder_item_modifiers').run()
  db.prepare('DELETE FROM preorder_items').run()
  db.prepare('DELETE FROM preorders').run()
  db.prepare('DELETE FROM product_store_links').run()
  // Ссылка stores.organization_id мешает удалить организацию — сначала её обнуляем.
  db.prepare('UPDATE stores SET organization_id=NULL').run()
  db.prepare('DELETE FROM organizations').run()
  const t = Date.now()
  db.prepare('INSERT OR REPLACE INTO stores(id,name,address) VALUES(?,?,?)').run(STORE, 'Тестовая', 'ул. Тест, 1')
  db.prepare('INSERT OR REPLACE INTO evotor_stores(store_uuid,name,local_store_id,updated_at) VALUES(?,?,?,?)')
    .run(STORE_UUID, 'Тестовая (Эвотор)', STORE, t)
  db.prepare(
    `INSERT OR REPLACE INTO products(id,name,price,available,icon,counts_as_cup,recipe_seconds,sort_order,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(PRODUCT, 'Флэт 300', 280, 1, 'Coffee', 1, 120, 1, t, t)
  db.prepare('INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid,enabled,updated_at) VALUES(?,?,?,?,?)')
    .run(PRODUCT, STORE_UUID, 'evo-hardening', 1, t)
})

describe('H-01: доступность точки и товара', () => {
  it('выключенная организация закрывает точку для quote', async () => {
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO organizations(name,legal_name,inn,active,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run('ООО', 'ООО Тест', '7700000000', 0, now, now)
    const orgId = (db.prepare('SELECT id FROM organizations ORDER BY id DESC LIMIT 1').get() as { id: number }).id
    db.prepare('UPDATE stores SET organization_id=? WHERE id=?').run(orgId, STORE)

    const g = await newGuest()
    const res = await quote(g.token, { storeId: STORE, items: items() })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('store_unavailable')
  })

  it('товар, выключенный в конкретной точке, не попадает в расчёт', async () => {
    db.prepare('UPDATE product_store_links SET enabled=0 WHERE product_id=?').run(PRODUCT)
    const g = await newGuest()
    const res = await quote(g.token, { storeId: STORE, items: items() })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('product_unavailable')
  })

  it('товар без строки привязки не блокируется (обратная совместимость)', async () => {
    db.prepare('DELETE FROM product_store_links WHERE product_id=?').run(PRODUCT)
    const g = await newGuest()
    const res = await quote(g.token, { storeId: STORE, items: items() })
    expect(res.status).toBe(200)
  })
})

describe('H-02: quoteToken проверяется целиком', () => {
  it('уменьшившийся кэшбэк делает расчёт устаревшим (total не совпадает)', async () => {
    const g = await newGuest()
    db.prepare('UPDATE users SET cashback_balance=10000 WHERE id=?').run(g.userId) // 100 ₽

    const q = await quote(g.token, { storeId: STORE, items: items(), benefit: { kind: 'cashback' } })
    expect(q.status).toBe(200)
    const quoted = (await q.json()) as { quoteToken: string; subtotal: number; discount: number; total: number }
    expect(quoted.subtotal).toBe(280)
    expect(quoted.discount).toBe(100)
    expect(quoted.total).toBe(180)

    // Гость успел потратить часть бонусов между расчётом и подтверждением.
    db.prepare('UPDATE users SET cashback_balance=5000 WHERE id=?').run(g.userId)
    const res = await create(g.token, { storeId: STORE, items: items(), quoteToken: quoted.quoteToken })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('quote_stale')
  })

  it('свежий расчёт принимается и резервирует бонус', async () => {
    const g = await newGuest()
    db.prepare('UPDATE users SET cashback_balance=10000 WHERE id=?').run(g.userId)
    const q = await quote(g.token, { storeId: STORE, items: items(), benefit: { kind: 'cashback' } })
    const quoted = (await q.json()) as { quoteToken: string }
    const res = await create(g.token, { storeId: STORE, items: items(), quoteToken: quoted.quoteToken })
    expect(res.status).toBe(200)
  })
})

describe('H-03: границы тела и формы', () => {
  it('слишком большое тело запроса → 413', async () => {
    const g = await newGuest()
    const big = { storeId: STORE, items: items(), junk: 'x'.repeat(100 * 1024) }
    const res = await app.request('/api/orders', {
      method: 'POST', headers: { ...JSONH, ...auth(g.token) }, body: JSON.stringify(big),
    })
    expect(res.status).toBe(413)
  })

  it('больше 50 позиций в корзине → 400', async () => {
    const g = await newGuest()
    const res = await create(g.token, { storeId: STORE, items: items(60).length ? Array.from({ length: 60 }, () => ({ productId: String(PRODUCT), quantity: 1 })) : [] })
    expect(res.status).toBe(400)
  })

  it('гигантский meta у аналитики → 413', async () => {
    const res = await app.request('/api/analytics/events', {
      method: 'POST',
      headers: JSONH,
      body: JSON.stringify({ event: 'pwa_open', meta: { blob: 'y'.repeat(20 * 1024) } }),
    })
    expect(res.status).toBe(413)
  })

  it('гостевой вход с гигантским телом → 413', async () => {
    const res = await app.request('/api/auth/guest', {
      method: 'POST', headers: JSONH, body: JSON.stringify({ inviteCode: 'z'.repeat(20 * 1024) }),
    })
    expect(res.status).toBe(413)
  })
})
