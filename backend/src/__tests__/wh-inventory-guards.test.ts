/**
 * Q-03: проведение инвентаризации только из `counting`/`review`, не пустой документ,
 * защита от двойного проведения (D-11).
 */
import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin, balance, createItem, createSupplier, receive } from './wh-helpers'

const item = (name: string) => createItem(name, 'g')

async function newDoc(stockItemId: number, kind: 'full' | 'partial' = 'partial') {
  const r = await admin('POST', '/inventory', { kind, stockItemIds: [stockItemId] })
  expect(r.status).toBe(201)
  return r.json.id as number
}

const docRow = (id: number) =>
  db.prepare('SELECT status, posted_at AS postedAt FROM inventory_docs WHERE id=?').get(id) as {
    status: string
    postedAt: number | null
  }

const movementsOfDoc = (id: number) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE doc_type='inventory' AND doc_id=?`).get(id) as {
    n: number
  }).n

describe('Q-03: защита статусов проведения инвентаризации', () => {
  it('отменённый документ провести нельзя', async () => {
    const it1 = await item('Инв отменённый')
    await receive(await createSupplier('Пост инв'), [{ stockItemId: it1, qty: 10 }])
    const id = await newDoc(it1)
    await admin('PATCH', `/inventory/${id}/lines`, { lines: [{ stockItemId: it1, factQty: 8 }] })
    db.prepare(`UPDATE inventory_docs SET status='cancelled' WHERE id=?`).run(id)

    const r = await admin('POST', `/inventory/${id}/post`)
    expect(r.status).toBe(400)
    expect(r.json.error ?? r.json.message).toMatch(/отмен/i)
    expect(docRow(id).status).toBe('cancelled')
    expect(movementsOfDoc(id)).toBe(0)
    expect(balance(it1)).toBe(10)
  })

  it('черновик без подсчёта провести нельзя', async () => {
    const it1 = await item('Инв черновик')
    await receive(await createSupplier('Пост инв2'), [{ stockItemId: it1, qty: 10 }])
    const id = await newDoc(it1)

    const r = await admin('POST', `/inventory/${id}/post`)
    expect(r.status).toBe(400)
    expect(docRow(id).status).toBe('draft')
    expect(movementsOfDoc(id)).toBe(0)
  })

  it('документ без строк провести нельзя', async () => {
    const it1 = await item('Инв пустой')
    const t = Date.now()
    const info = db
      .prepare(`INSERT INTO inventory_docs(store_uuid, kind, status, notes, created_at, updated_at) VALUES(NULL,'partial','counting',NULL,?,?)`)
      .run(t, t)
    const id = Number(info.lastInsertRowid)

    const r = await admin('POST', `/inventory/${id}/post`)
    expect(r.status).toBe(400)
    expect(r.json.error ?? r.json.message).toMatch(/нет строк/i)
    expect(docRow(id).status).toBe('counting')
    void it1
  })

  it('нормальный путь из counting: проведение и движения', async () => {
    const it1 = await item('Инв normal')
    await receive(await createSupplier('Пост инв3'), [{ stockItemId: it1, qty: 10 }])
    const id = await newDoc(it1)
    await admin('PATCH', `/inventory/${id}/lines`, { lines: [{ stockItemId: it1, factQty: 8 }] })
    expect(docRow(id).status).toBe('counting')

    const r = await admin('POST', `/inventory/${id}/post`)
    expect(r.status).toBe(200)
    expect(docRow(id).status).toBe('posted')
    expect(balance(it1)).toBe(8)
  })

  it('нормальный путь из review', async () => {
    const it1 = await item('Инв review')
    await receive(await createSupplier('Пост инв4'), [{ stockItemId: it1, qty: 10 }])
    const id = await newDoc(it1)
    await admin('PATCH', `/inventory/${id}/lines`, { lines: [{ stockItemId: it1, factQty: 12 }] })
    db.prepare(`UPDATE inventory_docs SET status='review' WHERE id=?`).run(id)

    const r = await admin('POST', `/inventory/${id}/post`)
    expect(r.status).toBe(200)
    expect(docRow(id).status).toBe('posted')
    expect(balance(it1)).toBe(12)
  })

  it('повторное проведение отклоняется и не дублирует движения', async () => {
    const it1 = await item('Инв повтор')
    await receive(await createSupplier('Пост инв5'), [{ stockItemId: it1, qty: 10 }])
    const id = await newDoc(it1)
    await admin('PATCH', `/inventory/${id}/lines`, { lines: [{ stockItemId: it1, factQty: 7 }] })

    expect((await admin('POST', `/inventory/${id}/post`)).status).toBe(200)
    const after = movementsOfDoc(id)

    const again = await admin('POST', `/inventory/${id}/post`)
    expect(again.status).toBe(400)
    expect(movementsOfDoc(id)).toBe(after)
    expect(balance(it1)).toBe(7)
  })
})
