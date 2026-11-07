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
        items: [{ productId: '1', quantity: 1, modifiers: [{ groupKey: 'milk', modifierId: 'coconut' }] }],
      },
      { secret: 'test-secret' },
    )
    expect(order.status).toBe('draft')
    expect(order.shortCode).toMatch(/^\d{6}$/)
    expect(order.estimateTotal).toBeGreaterThan(0)
    expect(qrPayload.startsWith('ord1.')).toBe(true)
    expect(order.items.length).toBe(1)
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
