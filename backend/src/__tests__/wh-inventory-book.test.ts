/**
 * Q-04: дельта инвентаризации считается от остатка на момент ПРОВЕДЕНИЯ (D-12, D-13),
 * а не от снимка, снятого при создании документа.
 */
import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin, balance, createItem, createSupplier, receive } from './wh-helpers'

const STORE_A = 'store-wh-book-a'
const STORE_B = 'store-wh-book-b'

function store(uuid: string, name: string) {
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, updated_at) VALUES(?,?,?)
     ON CONFLICT(store_uuid) DO NOTHING`,
  ).run(uuid, name, Date.now())
}

/** Прямая продажа мимо API: имитирует чек кассы, пришедший между созданием и проведением. */
function saleOut(stockItemId: number, qty: number, storeUuid: string | null = null) {
  db.prepare(
    `INSERT INTO stock_movements(stock_item_id, batch_id, store_uuid, qty, kind, doc_type, doc_id, note, created_at)
     VALUES(?,NULL,?,?,'sale_out','evotor_sell',?,'тест',?)`,
  ).run(stockItemId, storeUuid, -qty, `test-sell-${stockItemId}-${Date.now()}`, Date.now())
}

const bookOf = (docId: number, itemId: number) =>
  Number(
    (
      db
        .prepare('SELECT book_qty AS b FROM inventory_lines WHERE doc_id=? AND stock_item_id=?')
        .get(docId, itemId) as { b: number }
    ).b,
  )

async function docFor(stockItemId: number, storeUuid: string | null = null) {
  const r = await admin('POST', '/inventory', { kind: 'partial', stockItemIds: [stockItemId], storeUuid })
  expect(r.status).toBe(201)
  return r.json.id as number
}

async function countAndPost(docId: number, stockItemId: number, factQty: number) {
  await admin('PATCH', `/inventory/${docId}/lines`, { lines: [{ stockItemId, factQty }] })
  return admin('POST', `/inventory/${docId}/post`)
}

describe('Q-04: книжный остаток на момент проведения', () => {
  it('продажа между созданием и проведением: факт = новому остатку → движений нет', async () => {
    const it1 = await createItem('Книга A', 'g')
    await receive(await createSupplier('Пост книга'), [{ stockItemId: it1, qty: 10 }])
    const docId = await docFor(it1)
    expect(bookOf(docId, it1)).toBe(10) // снимок при создании

    saleOut(it1, 2)
    const r = await countAndPost(docId, it1, 8)
    expect(r.status).toBe(200)

    expect(balance(it1)).toBe(8)
    expect(bookOf(docId, it1)).toBe(8) // пересчитан на момент проведения
    const adj = db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE doc_type='inventory' AND doc_id=?`).get(docId) as {
      n: number
    }
    expect(adj.n).toBe(0)
  })

  it('реальная недостача после продажи: корректировка −1', async () => {
    const it1 = await createItem('Книга B', 'g')
    await receive(await createSupplier('Пост книга B'), [{ stockItemId: it1, qty: 10 }])
    const docId = await docFor(it1)
    saleOut(it1, 2)

    const r = await countAndPost(docId, it1, 7)
    expect(r.status).toBe(200)
    expect(balance(it1)).toBe(7)
    const adj = db
      .prepare(`SELECT qty FROM stock_movements WHERE doc_type='inventory' AND doc_id=?`)
      .all(docId) as { qty: number }[]
    expect(adj).toHaveLength(1)
    expect(adj[0].qty).toBe(-1)
  })

  it('приход между созданием и проведением не создаёт ложной недостачи', async () => {
    const it1 = await createItem('Книга C', 'g')
    const supplier = await createSupplier('Пост книга C')
    await receive(supplier, [{ stockItemId: it1, qty: 10 }])
    const docId = await docFor(it1)
    await receive(supplier, [{ stockItemId: it1, qty: 5 }])

    const r = await countAndPost(docId, it1, 15)
    expect(r.status).toBe(200)
    expect(balance(it1)).toBe(15)
    const adj = db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE doc_type='inventory' AND doc_id=?`).get(docId) as {
      n: number
    }
    expect(adj.n).toBe(0)
  })

  it('дельта меньше допуска не пишет движение', async () => {
    const it1 = await createItem('Книга D', 'g')
    await receive(await createSupplier('Пост книга D'), [{ stockItemId: it1, qty: 10 }])
    const docId = await docFor(it1)

    const r = await countAndPost(docId, it1, 10.0000000001)
    expect(r.status).toBe(200)
    const adj = db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE doc_type='inventory' AND doc_id=?`).get(docId) as {
      n: number
    }
    expect(adj.n).toBe(0)
  })

  it('движения другой точки не влияют на дельту документа с точкой', async () => {
    store(STORE_A, 'Точка A')
    store(STORE_B, 'Точка B')
    const it1 = await createItem('Книга E', 'g')
    const supplier = await createSupplier('Пост книга E')
    await receive(supplier, [{ stockItemId: it1, qty: 10 }], { storeUuid: STORE_A })
    await receive(supplier, [{ stockItemId: it1, qty: 4 }], { storeUuid: STORE_B })

    const docId = await docFor(it1, STORE_A)
    // продажа на чужой точке не должна уменьшать книгу документа точки A
    saleOut(it1, 1, STORE_B)

    const r = await countAndPost(docId, it1, 10)
    expect(r.status).toBe(200)
    expect(bookOf(docId, it1)).toBe(10)
    const adj = db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE doc_type='inventory' AND doc_id=?`).get(docId) as {
      n: number
    }
    expect(adj.n).toBe(0)
  })
})
