/**
 * U-01 / D-19: точка в накладной, заказе и инвентаризации; «общий склад» = NULL.
 */
import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin, balance, createItem, createSupplier, receive } from './wh-helpers'

const STORE = 'store-wh-stores-a'

function store(uuid: string, name: string) {
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, updated_at) VALUES(?,?,?)
     ON CONFLICT(store_uuid) DO NOTHING`,
  ).run(uuid, name, Date.now())
}

describe('U-01: точки в документах склада', () => {
  it('GET /stock/stores отдаёт точки', async () => {
    store(STORE, 'Точка Складская')
    const r = await admin('GET', '/stock/stores')
    expect(r.status).toBe(200)
    expect(r.json.stores.some((s: any) => s.uuid === STORE)).toBe(true)
  })

  it('накладная с точкой: партия и движение получают store_uuid', async () => {
    store(STORE, 'Точка Накладная')
    const supplierId = await createSupplier('Пост точка накладной')
    const item = await createItem('Сырьё точки', 'g')
    const invId = await receive(supplierId, [{ stockItemId: item, qty: 10 }], { storeUuid: STORE })

    const batch = db
      .prepare(`SELECT store_uuid AS s FROM stock_batches WHERE stock_item_id=? AND source_id=?`)
      .get(item, invId) as { s: string | null }
    expect(batch.s).toBe(STORE)

    const move = db
      .prepare(`SELECT store_uuid AS s FROM stock_movements WHERE stock_item_id=? AND doc_type='purchase_invoice' AND doc_id=?`)
      .get(item, invId) as { s: string | null }
    expect(move.s).toBe(STORE)

    expect(balance(item, STORE)).toBe(10)
    const perStore = await admin('GET', `/stock/balances?storeUuid=${STORE}`)
    const row = perStore.json.balances.find((b: any) => b.id === item)
    expect(row.expectedQty).toBe(10)
  })

  it('неизвестная точка отклоняется, пустая строка = общий склад', async () => {
    const supplierId = await createSupplier('Пост точка ошибки')
    const item = await createItem('Сырьё без точки', 'g')

    const bad = await admin('POST', '/purchases/invoices', {
      supplierId,
      storeUuid: 'store-does-not-exist',
      lines: [{ stockItemId: item, qty: 1, unitCostKop: 100 }],
    })
    expect(bad.status).toBe(400)
    expect(bad.json.error ?? bad.json.message).toMatch(/Точка не найдена/i)

    const ok = await admin('POST', '/purchases/invoices', {
      supplierId,
      storeUuid: '',
      lines: [{ stockItemId: item, qty: 1, unitCostKop: 100 }],
    })
    expect(ok.status).toBe(201)
    const inv = db.prepare(`SELECT store_uuid AS s FROM purchase_invoices WHERE id=?`).get(ok.json.id) as {
      s: string | null
    }
    expect(inv.s).toBeNull()
  })

  it('заказ с неизвестной точкой отклоняется', async () => {
    const supplierId = await createSupplier('Пост точка заказа')
    const item = await createItem('Сырьё заказа точки', 'g')
    const r = await admin('POST', '/purchases/orders', {
      supplierId,
      storeUuid: 'nope',
      lines: [{ stockItemId: item, qty: 1, priceKop: 100 }],
    })
    expect(r.status).toBe(400)
  })

  it('инвентаризация с точкой считает остаток только по ней', async () => {
    store(STORE, 'Точка Инвентаризация')
    const supplierId = await createSupplier('Пост точка инв')
    const item = await createItem('Сырьё инв точки', 'g')
    await receive(supplierId, [{ stockItemId: item, qty: 7 }], { storeUuid: STORE })
    await receive(supplierId, [{ stockItemId: item, qty: 100 }]) // общий склад

    const doc = await admin('POST', '/inventory', { kind: 'partial', stockItemIds: [item], storeUuid: STORE })
    expect(doc.status).toBe(201)
    const line = db
      .prepare(`SELECT book_qty AS b FROM inventory_lines WHERE doc_id=? AND stock_item_id=?`)
      .get(doc.json.id, item) as { b: number }
    expect(line.b).toBe(7)
  })
})
