/**
 * Pure logic tests for preorder service using an in-memory sqlite-like stub.
 * Run: npx vitest/jest on this file when backend test runner is available.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDraftOrder,
  ensurePreorderTables,
  getOrder,
  listActive,
  markPaid,
  rejectOrder,
  transitionStatus,
  cancelDraft,
  buildQrPayload,
} from '../modules/orders/service'

/** Minimal better-sqlite3 compatible memory db using sql.js-like map — simplified for CI. */
function createMemoryDb() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE stores (id INTEGER PRIMARY KEY, name TEXT, address TEXT);
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price INTEGER, icon TEXT DEFAULT 'Coffee', available INTEGER DEFAULT 1, evotor_uuid TEXT);
    INSERT INTO stores (id, name, address) VALUES (1, 'Покровка', 'Покровка 12');
    INSERT INTO products (id, name, price, available, evotor_uuid) VALUES (1, 'Капучино', 260, 1, 'evo-cap');
    INSERT INTO products (id, name, price, available, evotor_uuid) VALUES (2, 'Флэт уайт', 280, 1, 'evo-flat');
  `)
  return db
}

describe('preorder service', () => {
  let db: ReturnType<typeof createMemoryDb>
  beforeEach(() => {
    db = createMemoryDb()
    ensurePreorderTables(db)
  })

  it('creates draft with short code and qr', () => {
    const { order, qrPayload } = createDraftOrder(
      db,
      {
        storeId: 1,
        items: [{ productId: '1', quantity: 1 }],
      },
      { secret: 'test-secret' },
    )
    expect(order.status).toBe('draft')
    expect(order.shortCode).toMatch(/^\d{6}$/)
    expect(order.estimateTotal).toBeGreaterThan(0)
    expect(qrPayload.startsWith('ord1.')).toBe(true)
    expect(order.items.length).toBe(1)
  })

  it('выдуманная добавка не принимается (P0-1): у товара нет такой опции', () => {
    expect(() =>
      createDraftOrder(
        db,
        {
          storeId: 1,
          items: [{ productId: '1', quantity: 1, modifiers: [{ groupKey: 'milk', modifierId: 'coconut' }] }],
        },
        { secret: 'test-secret' },
      ),
    ).toThrow(/недоступн/i)
  })

  it('клиентская цена добавки игнорируется: в заказ идёт серверная', () => {
    // Схема с опцией: id опции 1, цена 40. Клиент пытается прислать 0 — сумма должна остаться 300.
    db.exec(`
      CREATE TABLE modifier_schemes (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE modifier_scheme_items (id INTEGER PRIMARY KEY, scheme_id INTEGER, modifier_id INTEGER,
        product_id INTEGER, group_key TEXT, required INTEGER DEFAULT 0, max_count INTEGER DEFAULT 1,
        is_default INTEGER DEFAULT 0, zero_option INTEGER DEFAULT 0, price_override INTEGER, name_override TEXT, sort_order INTEGER DEFAULT 0);
      CREATE TABLE modifiers (id INTEGER PRIMARY KEY, name TEXT, price INTEGER, group_key TEXT, available INTEGER DEFAULT 1, linked_product_id INTEGER, sort_order INTEGER DEFAULT 0);
      INSERT INTO modifier_schemes (id, name) VALUES (1, 'Сиропы');
      INSERT INTO modifiers (id, name, price, group_key, available) VALUES (7, 'Ваниль', 40, 'syrup', 1);
      INSERT INTO modifier_scheme_items (id, scheme_id, modifier_id, group_key, max_count, sort_order)
        VALUES (1, 1, 7, 'syrup', 2, 0);
    `)
    const cols = (db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map((c) => c.name)
    if (!cols.includes('modifier_scheme_id')) db.exec('ALTER TABLE products ADD COLUMN modifier_scheme_id INTEGER')
    db.prepare('UPDATE products SET modifier_scheme_id=1 WHERE id=1').run()

    const { order } = createDraftOrder(
      db,
      {
        storeId: 1,
        items: [{
          productId: '1',
          quantity: 1,
          modifiers: [{ groupKey: 'syrup', modifierId: '1', name: 'Бесплатно', priceRub: 0 } as never],
        }],
      },
      { secret: 'test-secret' },
    )
    expect(order.estimateTotal).toBe(300)
    expect(order.items[0].modifiers[0]).toMatchObject({ name: 'Ваниль', priceEstimate: 40 })
  })

  it('transitions accepted -> cooking -> ready', () => {
    const { order } = createDraftOrder(db, { storeId: 1, items: [{ productId: '1', quantity: 1 }] }, { secret: 's' })
    const a = transitionStatus(db, order.id, 'accepted')
    expect(a.status).toBe('accepted')
    const c = transitionStatus(db, order.id, 'cooking')
    expect(c.status).toBe('cooking')
    const r = transitionStatus(db, order.id, 'ready')
    expect(r.status).toBe('ready')
  })

  it('rejects invalid transition', () => {
    const { order } = createDraftOrder(db, { storeId: 1, items: [{ productId: '1', quantity: 1 }] }, { secret: 's' })
    expect(() => transitionStatus(db, order.id, 'ready')).toThrow()
  })

  it('lists active and excludes cancelled', () => {
    const { order } = createDraftOrder(db, { storeId: 1, items: [{ productId: '1', quantity: 1 }] }, { secret: 's' })
    expect(listActive(db, 1).length).toBe(1)
    cancelDraft(db, order.id)
    expect(listActive(db, 1).length).toBe(0)
  })

  it('mark paid from ready', () => {
    const { order } = createDraftOrder(db, { storeId: 1, items: [{ productId: '2', quantity: 1 }] }, { secret: 's' })
    transitionStatus(db, order.id, 'accepted')
    transitionStatus(db, order.id, 'cooking')
    transitionStatus(db, order.id, 'ready')
    const paid = markPaid(db, order.id)
    expect(paid.status).toBe('paid')
    const again = markPaid(db, order.id)
    expect(again.status).toBe('paid')
  })

  it('reject works from accepted', () => {
    const { order } = createDraftOrder(db, { storeId: 1, items: [{ productId: '1', quantity: 1 }] }, { secret: 's' })
    transitionStatus(db, order.id, 'accepted')
    rejectOrder(db, order.id, 'нет молока')
    expect(getOrder(db, order.id)?.status).toBe('rejected')
  })

  it('buildQrPayload format', () => {
    const q = buildQrPayload('oid', 1, 9999999999, 'secret')
    expect(q.split('.').length).toBe(3)
    expect(q.startsWith('ord1.')).toBe(true)
  })
})
