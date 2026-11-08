/**
 * P0-1 / P0-2: цена и состав заказа считаются на сервере, uuid добавок — по связям точки.
 *
 * Клиент присылает только выбор опций. Цена из запроса не участвует, чужая опция — 400,
 * а добавка без связи с точкой получает `evotorUuid: null` + предупреждение (uuid не выдумываем).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-order-pricing-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { config } = await import('../config')
const { db } = await import('../db')

const H_ADMIN = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const JSONH = { 'content-type': 'application/json' }
const T = Date.now()
const STORE = 10
const SKU = 5010
const VANILLA = 7001
const LINKED_PRODUCT = 7010

let guest = { token: '', userId: 0 }

async function mkGuest() {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: JSONH, body: '{}' })
  const { token } = (await r.json()) as { token: string }
  const me = await app.request('/api/loyalty/card', { headers: { Authorization: 'Bearer ' + token } })
  const j = (await me.json()) as { cardCode?: string }
  const row = db.prepare('SELECT id FROM users WHERE card_code=?').get(String(j.cardCode)) as { id: number }
  return { token, userId: Number(row.id) }
}

const quote = async (items: unknown[]) => {
  const r = await app.request('/api/orders/quote', {
    method: 'POST',
    headers: { ...JSONH, Authorization: 'Bearer ' + guest.token },
    body: JSON.stringify({ storeId: STORE, items, benefit: null }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, any> }
}

const createOrder = async (items: unknown[]) => {
  const r = await app.request('/api/orders', {
    method: 'POST',
    headers: { ...JSONH, Authorization: 'Bearer ' + guest.token },
    body: JSON.stringify({ storeId: STORE, items }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, any> }
}

beforeEach(async () => {
  const t = Date.now()
  db.prepare(`INSERT OR REPLACE INTO stores(id,name,address) VALUES(?,?,?)`).run(STORE, 'Покровка', 'Покровка 12')
  db.prepare(`INSERT OR REPLACE INTO evotor_stores(store_uuid,name,local_store_id,updated_at)
    VALUES('ev-store-pricing','Покровка',?,?)`).run(STORE, t)
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,available,icon,counts_as_cup,sort_order,created_at,updated_at)
    VALUES(?,?,?,1,'Coffee',1,1,?,?)`).run(SKU, 'Капучино', 300, t, t)
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,available,icon,sort_order,created_at,updated_at)
    VALUES(?,?,?,1,'Milk',2,?,?)`).run(LINKED_PRODUCT, 'Кокосовое молоко', 50, t, t)
  db.prepare(`INSERT OR REPLACE INTO modifiers(id,name,price,group_key,available,linked_product_id,sort_order,created_at,updated_at)
    VALUES(?,?,?,?,1,?,0,?,?)`).run(VANILLA, 'Ваниль', 40, 'syrup', LINKED_PRODUCT, t, t)

  const scheme = await app.request('/api/admin/modifier-schemes', {
    method: 'POST',
    headers: H_ADMIN,
    body: JSON.stringify({
      name: `Схема-${T}`,
      options: [
        { kind: 'modifier', modifierId: VANILLA, groupKey: 'syrup', maxCount: 2, required: false },
      ],
    }),
  })
  const schemeId = Number(((await scheme.json()) as any).id ?? ((await scheme.json()) as any).scheme?.id)
  db.prepare('UPDATE products SET modifier_scheme_id=? WHERE id=?').run(schemeId, SKU)

  guest = await mkGuest()
})

const optionId = (): string => {
  const row = db
    .prepare(`SELECT o.id FROM modifier_scheme_options o JOIN products p ON p.modifier_scheme_id=o.scheme_id WHERE p.id=? ORDER BY o.id LIMIT 1`)
    .get(SKU) as { id: number } | undefined
  return String(row?.id ?? '')
}

describe('P0-1: серверная цена и состав', () => {
  it('цена из запроса не участвует: 0 не занижает сумму', async () => {
    const id = optionId()
    const { status, body } = await quote([{ productId: String(SKU), quantity: 1, modifiers: [{ modifierId: id, priceRub: 0 }] }])
    expect(status).toBe(200)
    expect(body.subtotal).toBe(340)
  })

  it('чужая опция — 400/409 и никакого «примем как есть»', async () => {
    const bad = await quote([{ productId: String(SKU), quantity: 1, modifiers: [{ modifierId: '999999' }] }])
    expect([400, 409]).toContain(bad.status)
    expect(bad.body.error).toBe('modifier_not_allowed')

    const order = await createOrder([{ productId: String(SKU), quantity: 1, modifiers: [{ modifierId: '999999' }] }])
    expect(order.status).toBe(400)
    expect(order.body.error).toBe('modifier_not_allowed')
  })

  it('quote и заказ согласованы по добавке (B-07)', async () => {
    const id = optionId()
    const q = await quote([{ productId: String(SKU), quantity: 1, modifiers: [{ modifierId: id }] }])
    expect(q.status).toBe(200)
    const o = await createOrder([{ productId: String(SKU), quantity: 1, modifiers: [{ modifierId: id }] }])
    expect(o.status).toBe(200)
    expect(o.body.order.estimateTotal).toBe(q.body.total)
  })

  it('превышение maxCount — понятная ошибка', async () => {
    const id = optionId()
    const { status, body } = await quote([
      { productId: String(SKU), quantity: 1, modifiers: [{ modifierId: id }, { modifierId: id }, { modifierId: id }] },
    ])
    expect([400, 409]).toContain(status)
    expect(body.error).toBe('modifier_limit')
  })
})

describe('P0-2: uuid добавок', () => {
  it('есть связь товара с точкой → evotorUuid заполнен', async () => {
    const id = optionId()
    db.prepare(`INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid,enabled)
      VALUES(?,?,?,1)`).run(LINKED_PRODUCT, 'ev-store-pricing', 'evo-vanilla')
    const o = await createOrder([{ productId: String(SKU), quantity: 1, modifiers: [{ modifierId: id }] }])
    expect(o.status).toBe(200)
    expect(o.body.order.items[0].modifiers[0]).toMatchObject({ evotorUuid: 'evo-vanilla', warning: null })
  })

  it('нет связи → evotorUuid null + warning, заказ при этом создаётся', async () => {
    const id = optionId()
    db.prepare('DELETE FROM product_store_links WHERE product_id=?').run(LINKED_PRODUCT)
    const o = await createOrder([{ productId: String(SKU), quantity: 1, modifiers: [{ modifierId: id }] }])
    expect(o.status).toBe(200)
    expect(o.body.order.items[0].modifiers[0]).toMatchObject({ evotorUuid: null, warning: 'no_evotor_uuid' })
    expect(o.body.order.warnings.join(' ')).toContain('no_evotor_uuid')
  })
})
