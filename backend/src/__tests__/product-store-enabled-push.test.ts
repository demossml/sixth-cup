import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db'
import { ProductPushService } from '../integrations/evotor/sync/ProductPushService'
import { enqueueProductSync } from '../modules/admin/enqueue'

const S_A = 'store-enabled-a'
const S_B = 'store-enabled-b'

let productOnA = 0
let productNoLinks = 0

function outboxFor(store: string, productId: number) {
  return db.prepare(
    `SELECT id, status FROM evotor_outbox WHERE store_uuid=? AND entity='PRODUCT' AND entity_key=?`,
  ).all(store, String(productId)) as { id: number; status: string }[]
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

describe('R-02: product_store_links.enabled фильтрует выгрузку', () => {
  beforeAll(() => {
    addStore(S_A)
    addStore(S_B)
    productOnA = addProduct('Только-точка-A')
    productNoLinks = addProduct('Без-связей')

    // Товар разрешён на A и выключен на B.
    db.prepare(`INSERT INTO product_store_links(product_id, store_uuid, enabled) VALUES(?,?,1)`)
      .run(productOnA, S_A)
    db.prepare(`INSERT INTO product_store_links(product_id, store_uuid, enabled) VALUES(?,?,0)`)
      .run(productOnA, S_B)

    // Чистим очередь, чтобы проверять только наши товары.
    db.prepare(`DELETE FROM evotor_outbox WHERE store_uuid IN (?,?)`).run(S_A, S_B)
  })

  it('ставит в очередь только разрешённые точки', () => {
    enqueueProductSync([productOnA])
    expect(outboxFor(S_A, productOnA).length).toBe(1)
    expect(outboxFor(S_B, productOnA).length).toBe(0)
  })

  it('товар без строк в links выгружается на все sync-точки (обратная совместимость)', () => {
    enqueueProductSync([productNoLinks])
    expect(outboxFor(S_A, productNoLinks).length).toBe(1)
    expect(outboxFor(S_B, productNoLinks).length).toBe(1)
  })

  it('productEnabledForStore читает галочку и по умолчанию разрешает', () => {
    const svc = new ProductPushService(db as never)
    expect(svc.productEnabledForStore(productOnA, S_A)).toBe(true)
    expect(svc.productEnabledForStore(productOnA, S_B)).toBe(false)
    expect(svc.productEnabledForStore(productNoLinks, S_B)).toBe(true)
  })

  it('после снятия галочки новые изменения не ставятся в очередь', () => {
    db.prepare(`INSERT INTO product_store_links(product_id, store_uuid, enabled) VALUES(?,?,1)`)
      .run(productNoLinks, S_B)
    db.prepare(`DELETE FROM evotor_outbox WHERE store_uuid=? AND entity_key=?`).run(S_B, String(productNoLinks))
    enqueueProductSync([productNoLinks])
    expect(outboxFor(S_B, productNoLinks).length).toBe(1)

    db.prepare(`UPDATE product_store_links SET enabled=0 WHERE product_id=? AND store_uuid=?`).run(productNoLinks, S_B)
    db.prepare(`DELETE FROM evotor_outbox WHERE store_uuid=? AND entity_key=?`).run(S_B, String(productNoLinks))
    enqueueProductSync([productNoLinks])

    expect(outboxFor(S_B, productNoLinks).length).toBe(0)
    const svc = new ProductPushService(db as never)
    expect(svc.productEnabledForStore(productNoLinks, S_B)).toBe(false)

    // Возвращаем как было для других тестов.
    db.prepare(`UPDATE product_store_links SET enabled=1 WHERE product_id=? AND store_uuid=?`).run(productNoLinks, S_B)
  })
})
