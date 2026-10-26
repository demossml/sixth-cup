import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db'
import { ProductPushService } from '../integrations/evotor/sync/ProductPushService'
import { enqueueProductSync } from '../modules/admin/enqueue'

const S_A = 'store-enabled-a'
const S_B = 'store-enabled-b'

let productOnA = 0
let productNoLinks = 0
let productOnBoth = 0

function outboxFor(store: string, productId: number) {
  return db.prepare(
    `SELECT id, status, last_error AS lastError FROM evotor_outbox WHERE store_uuid=? AND entity='PRODUCT' AND entity_key=?`,
  ).all(store, String(productId)) as { id: number; status: string; lastError: string | null }[]
}

function addStore(uuid: string) {
  db.prepare(`INSERT OR IGNORE INTO evotor_stores(store_uuid, name, sync_enabled) VALUES(?,?,1)`).run(uuid, uuid)
}

function addProduct(name: string): number {
  const t = Date.now()
  const info = db.prepare(
    `INSERT INTO products(name, price, available, created_at, updated_at, catalog_source) VALUES(?,?,1,?,?,'SIXTH_CUP')`,
  ).run(name, 200, t, t)
  return Number(info.lastInsertRowid)
}

function link(productId: number, store: string, enabled: number) {
  db.prepare(
    `INSERT INTO product_store_links(product_id, store_uuid, enabled) VALUES(?,?,?)
     ON CONFLICT(product_id, store_uuid) DO UPDATE SET enabled=excluded.enabled`,
  ).run(productId, store, enabled)
}

function clearOutbox(productId: number) {
  db.prepare(`DELETE FROM evotor_outbox WHERE entity='PRODUCT' AND entity_key=?`).run(String(productId))
}

describe('R-02: product_store_links.enabled фильтрует выгрузку', () => {
  beforeAll(() => {
    addStore(S_A)
    addStore(S_B)
    productOnA = addProduct('Только-точка-A')
    productNoLinks = addProduct('Без-связей')
    productOnBoth = addProduct('Разрешён-везде')

    link(productOnA, S_A, 1)
    link(productOnA, S_B, 0)
    link(productOnBoth, S_A, 1)
    link(productOnBoth, S_B, 1)

    db.prepare(`DELETE FROM evotor_outbox WHERE store_uuid IN (?,?)`).run(S_A, S_B)
  })

  it('link enabled=1 → задача в очереди для этой точки', () => {
    clearOutbox(productOnBoth)
    enqueueProductSync([productOnBoth])
    expect(outboxFor(S_A, productOnBoth).length).toBe(1)
    expect(outboxFor(S_B, productOnBoth).length).toBe(1)
    expect(outboxFor(S_A, productOnBoth)[0].status).toBe('PENDING')
  })

  it('link enabled=0 → задачи нет для этой точки, но есть для разрешённой', () => {
    clearOutbox(productOnA)
    enqueueProductSync([productOnA])
    expect(outboxFor(S_A, productOnA).length).toBe(1)
    expect(outboxFor(S_B, productOnA).length).toBe(0)
  })

  it('строки нет в links → выгружается на все sync-точки (обратная совместимость)', () => {
    clearOutbox(productNoLinks)
    enqueueProductSync([productNoLinks])
    expect(outboxFor(S_A, productNoLinks).length).toBe(1)
    expect(outboxFor(S_B, productNoLinks).length).toBe(1)
  })

  it('productEnabledForStore: нет строки → true, enabled=1 → true, enabled=0 → false', () => {
    const svc = new ProductPushService(db as never)
    expect(svc.productEnabledForStore(productNoLinks, S_B)).toBe(true)
    expect(svc.productEnabledForStore(productOnBoth, S_B)).toBe(true)
    expect(svc.productEnabledForStore(productOnA, S_A)).toBe(true)
    expect(svc.productEnabledForStore(productOnA, S_B)).toBe(false)
  })

  it('после снятия галочки новые изменения не ставятся в очередь', () => {
    link(productNoLinks, S_B, 1)
    clearOutbox(productNoLinks)
    enqueueProductSync([productNoLinks])
    expect(outboxFor(S_B, productNoLinks).length).toBe(1)

    link(productNoLinks, S_B, 0)
    clearOutbox(productNoLinks)
    enqueueProductSync([productNoLinks])
    expect(outboxFor(S_B, productNoLinks).length).toBe(0)

    link(productNoLinks, S_B, 1) // вернуть как было для остальных тестов
  })

  it('pruneDisabledOutbox снимает уже стоящие строки, не трогая разрешённые', () => {
    // Готовим «залежавшуюся» очередь: одна разрешённая точка, одна выключенная.
    db.prepare(`UPDATE product_store_links SET enabled=0 WHERE product_id=? AND store_uuid=?`).run(productOnBoth, S_B)
    clearOutbox(productOnBoth)
    db.prepare(`INSERT INTO evotor_outbox(store_uuid,entity,entity_key,op,priority,status,attempts,next_at)
                VALUES(?,?,?,'UPSERT',5,'PENDING',0,0)`).run(S_A, 'PRODUCT', String(productOnBoth))
    db.prepare(`INSERT INTO evotor_outbox(store_uuid,entity,entity_key,op,priority,status,attempts,next_at)
                VALUES(?,?,?,'UPSERT',5,'PENDING',0,0)`).run(S_B, 'PRODUCT', String(productOnBoth))

    const svc = new ProductPushService(db as never)
    const removed = svc.pruneDisabledOutbox(S_B)
    expect(removed).toBe(1)

    const pool = outboxFor(S_B, productOnBoth)
    expect(pool.length).toBe(1)
    expect(pool[0].status).toBe('DONE')
    expect(pool[0].lastError).toContain('disabled')
    // Разрешённая точка не тронута.
    expect(outboxFor(S_A, productOnBoth)[0].status).toBe('PENDING')

    db.prepare(`UPDATE product_store_links SET enabled=1 WHERE product_id=? AND store_uuid=?`).run(productOnBoth, S_B)
    clearOutbox(productOnBoth)
  })
})
