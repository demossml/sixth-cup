/**
 * Q-08 / Q-09 / D-20: единый FEFO-помощник, партии своей точки, движения всегда привязаны
 * к партиям — `Σ движений = Σ qty_left`.
 */
import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { consumeFefo } from '../modules/admin/stockFefo'
import { writeOffSellByNorms } from '../modules/admin/stockWriteOff'
import { admin, balance, batchLeft, createItem, createSupplier, movements, productWithNorm, receive } from './wh-helpers'

const A = 'store-fefo-a'
const B = 'store-fefo-b'

function store(uuid: string, name: string) {
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, updated_at) VALUES(?,?,?)
     ON CONFLICT(store_uuid) DO NOTHING`,
  ).run(uuid, name, Date.now())
}

const batches = (itemId: number) =>
  db
    .prepare(
      `SELECT id, store_uuid AS storeUuid, qty_left AS qtyLeft, expires_at AS expiresAt
       FROM stock_batches WHERE stock_item_id=? ORDER BY id`,
    )
    .all(itemId) as { id: number; storeUuid: string | null; qtyLeft: number; expiresAt: number | null }[]

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`

/** Инвариант Q-09: без нехваток сумма движений равна сумме остатков партий. */
function assertLedgerMatchesBatches(itemId: number) {
  expect(balance(itemId)).toBeCloseTo(batchLeft(itemId), 6)
}

describe('Q-08: FEFO учитывает точку', () => {
  it('продажа точки A списывает партию A, партия B нетронута', async () => {
    store(A, 'Точка A')
    store(B, 'Точка B')
    const item = await createItem('FEFO точка', 'g')
    const supplier = await createSupplier('Пост FEFO')
    await receive(supplier, [{ stockItemId: item, qty: 10 }], { storeUuid: A })
    await receive(supplier, [{ stockItemId: item, qty: 10 }], { storeUuid: B })

    const [batchA, batchB] = batches(item)
    const commodity = uniq('uuid')
    await productWithNorm(701, commodity, A, item, 4)

    writeOffSellByNorms(db, A, uniq('sell'), [{ productUuid: commodity, qty: 1 }])

    const after = batches(item)
    expect(after.find((b) => b.id === batchA.id)?.qtyLeft).toBe(6)
    expect(after.find((b) => b.id === batchB.id)?.qtyLeft).toBe(10)
  })

  it('партия общего склада подходит продаже любой точки, чужая — нет', async () => {
    store(A, 'Точка A')
    store(B, 'Точка B')
    const item = await createItem('FEFO общий', 'g')
    const supplier = await createSupplier('Пост FEFO 2')
    await receive(supplier, [{ stockItemId: item, qty: 5 }]) // общий склад
    await receive(supplier, [{ stockItemId: item, qty: 5 }], { storeUuid: B })

    const commodity = uniq('uuid')
    await productWithNorm(702, commodity, A, item, 5)

    consumeFefo(db, {
      stockItemId: item,
      need: 5,
      storeUuid: A,
      kind: 'sale_out',
      docType: 'evotor_sell',
      docId: uniq('sell'),
      note: 'тест',
      noBatchNote: 'тест без партии',
      now: Date.now(),
    })

    const list = batches(item)
    expect(list[0].qtyLeft).toBe(0) // общий склад израсходован
    expect(list[1].qtyLeft).toBe(5) // чужая точка не тронута
    const shorts = movements(item).filter((m) => m.batchId === null)
    expect(shorts).toHaveLength(0)
  })

  it('чистый FEFO: раньше срок — раньше списание, без срока в конце', async () => {
    const item = await createItem('FEFO срок', 'g')
    const supplier = await createSupplier('Пост FEFO 3')
    const soon = Date.now() + 2 * 86_400_000
    const later = Date.now() + 30 * 86_400_000
    await receive(supplier, [{ stockItemId: item, qty: 5 }], { expiresAt: later })
    await receive(supplier, [{ stockItemId: item, qty: 5 }], { expiresAt: soon })
    await receive(supplier, [{ stockItemId: item, qty: 5 }]) // без срока

    consumeFefo(db, {
      stockItemId: item,
      need: 6,
      storeUuid: null,
      kind: 'sale_out',
      docType: 'evotor_sell',
      docId: uniq('sell'),
      note: 'тест',
      noBatchNote: 'тест без партии',
      now: Date.now(),
    })

    const list = batches(item)
    expect(list[0].qtyLeft).toBe(4) // дальний срок: тронут вторым, остаток 4
    expect(list[1].qtyLeft).toBe(0) // ближний срок — первым
    expect(list[2].qtyLeft).toBe(5) // без срока — последним, не тронут
  })

  it('подходящих партий нет: движение без партии, остаток в минусе (D-21)', async () => {
    store(B, 'Точка B')
    const item = await createItem('FEFO нехватка', 'g')
    await receive(await createSupplier('Пост FEFO 4'), [{ stockItemId: item, qty: 10 }], { storeUuid: B })
    const commodity = uniq('uuid')
    await productWithNorm(703, commodity, A, item, 4)

    writeOffSellByNorms(db, A, uniq('sell'), [{ productUuid: commodity, qty: 1 }])

    expect(balance(item, A)).toBe(-4)
    expect(batchLeft(item)).toBe(10) // партия B цела
    expect(movements(item).some((m) => m.batchId === null && m.kind === 'sale_out')).toBe(true)
  })
})

describe('Q-09: инвентаризация привязывает движения к партиям', () => {
  it('недостача и излишек: инвариант Σ движений = Σ qty_left', async () => {
    const item = await createItem('FEFO инвентаризация', 'g')
    await receive(await createSupplier('Пост FEFO 5'), [{ stockItemId: item, qty: 10 }])

    const inv = await admin('POST', '/inventory', { kind: 'partial', stockItemIds: [item] })
    await admin('PATCH', `/inventory/${inv.json.id}/lines`, { lines: [{ stockItemId: item, factQty: 7 }] })
    expect((await admin('POST', `/inventory/${inv.json.id}/post`)).status).toBe(200)

    const adj = movements(item).filter((m) => m.kind === 'inventory_adj')
    expect(adj).toHaveLength(1)
    expect(adj[0].qty).toBe(-3)
    expect(adj[0].batchId).not.toBeNull()
    assertLedgerMatchesBatches(item)

    const surplus = await admin('POST', '/inventory', { kind: 'partial', stockItemIds: [item] })
    await admin('PATCH', `/inventory/${surplus.json.id}/lines`, { lines: [{ stockItemId: item, factQty: 9 }] })
    expect((await admin('POST', `/inventory/${surplus.json.id}/post`)).status).toBe(200)

    const plus = movements(item).filter((m) => m.kind === 'inventory_adj' && m.qty > 0)
    expect(plus).toHaveLength(1)
    expect(plus[0].batchId).not.toBeNull()
    assertLedgerMatchesBatches(item)
  })
})

describe('Q-08: возврат поставщику списывает партии своей точки', () => {
  it('партия чужой точки не затрагивается', async () => {
    store(A, 'Точка A')
    store(B, 'Точка B')
    const supplierId = await createSupplier('Пост FEFO 6')
    const item = await createItem('FEFO возврат', 'g')
    await receive(supplierId, [{ stockItemId: item, qty: 6 }], { storeUuid: A })
    await receive(supplierId, [{ stockItemId: item, qty: 6 }], { storeUuid: B })

    const ret = await admin('POST', '/purchases/returns', {
      supplierId,
      storeUuid: A,
      lines: [{ stockItemId: item, qty: 4, priceKop: 100 }],
    })
    expect(ret.status).toBe(201)
    const posted = await admin('POST', `/purchases/returns/${ret.json.id}/post`)
    expect(posted.status).toBe(200)

    const list = batches(item)
    expect(list[0].qtyLeft).toBe(2) // точка A
    expect(list[1].qtyLeft).toBe(6) // точка B нетронута
    assertLedgerMatchesBatches(item)
  })
})
