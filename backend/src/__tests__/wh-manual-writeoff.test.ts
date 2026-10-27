/**
 * Q-11 / D-22: ручное списание одним шагом, с причиной и проверкой остатка.
 */
import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin, balance, createItem, createSupplier, movements, receive } from './wh-helpers'

const A = 'store-wo-a'
const B = 'store-wo-b'

function store(uuid: string, name: string) {
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, updated_at) VALUES(?,?,?)
     ON CONFLICT(store_uuid) DO NOTHING`,
  ).run(uuid, name, Date.now())
}

async function withStock(name: string, qty: number, storeUuid?: string) {
  const item = await createItem(name, 'kg')
  await receive(await createSupplier(`Пост ${name}`), [{ stockItemId: item, qty }], storeUuid ? { storeUuid } : {})
  return item
}

describe('Q-11: ручное списание', () => {
  it('списание 2 кг из остатка 5 уменьшает остаток и видно в расходе', async () => {
    const item = await withStock('Порча', 5)
    const r = await admin('POST', '/stock/writeoffs', {
      reason: 'spoilage',
      lines: [{ stockItemId: item, qty: 2 }],
    })
    expect(r.status).toBe(201)

    expect(balance(item)).toBe(3)
    const move = movements(item).find((m) => m.kind === 'write_off')
    expect(move?.qty).toBe(-2)
    expect(move?.batchId).not.toBeNull()

    const consumption = await admin('GET', `/stock/consumption?itemId=${item}&days=1`)
    expect(consumption.status).toBe(200)
    expect(consumption.json.days.at(-1).qty).toBeCloseTo(2, 6)
  })

  it('списание больше остатка отклоняется и ничего не пишет', async () => {
    const item = await withStock('Много', 3)
    const before = (db.prepare('SELECT COUNT(*) AS n FROM stock_writeoffs').get() as { n: number }).n

    const r = await admin('POST', '/stock/writeoffs', { reason: 'expired', lines: [{ stockItemId: item, qty: 5 }] })
    expect(r.status).toBe(400)
    expect(r.json.error ?? r.json.message).toMatch(/Недостаточно остатка/i)
    expect(balance(item)).toBe(3)
    const after = (db.prepare('SELECT COUNT(*) AS n FROM stock_writeoffs').get() as { n: number }).n
    expect(after).toBe(before)
    expect(movements(item).some((m) => m.kind === 'write_off')).toBe(false)
  })

  it('две строки одной позиции суммируются при проверке остатка', async () => {
    const item = await withStock('Дубли', 3)
    const r = await admin('POST', '/stock/writeoffs', {
      reason: 'other',
      lines: [
        { stockItemId: item, qty: 2 },
        { stockItemId: item, qty: 2 },
      ],
    })
    expect(r.status).toBe(400)
    expect(balance(item)).toBe(3)
  })

  it('неверная причина, неизвестная точка и выключенная позиция отклоняются', async () => {
    store(A, 'Точка списания')
    const item = await withStock('Причины', 5)

    expect(
      (await admin('POST', '/stock/writeoffs', { reason: 'nonsense', lines: [{ stockItemId: item, qty: 1 }] })).status,
    ).toBe(400)
    expect(
      (await admin('POST', '/stock/writeoffs', { reason: 'other', storeUuid: 'nope', lines: [{ stockItemId: item, qty: 1 }] }))
        .status,
    ).toBe(400)

    const { createItem: _c } = await import('./wh-helpers')
    void _c
    const off = await createItem('Выключенная', 'g', { active: false })
    expect(
      (await admin('POST', '/stock/writeoffs', { reason: 'other', lines: [{ stockItemId: off, qty: 1 }] })).status,
    ).toBe(400)
  })

  it('списание с точкой уменьшает остаток точки и не трогает партии чужой точки', async () => {
    store(A, 'Точка A')
    store(B, 'Точка B')
    const supplierId = await createSupplier('Пост точки списания')
    const item = await createItem('Точки списания', 'kg')
    await receive(supplierId, [{ stockItemId: item, qty: 5 }], { storeUuid: A })
    await receive(supplierId, [{ stockItemId: item, qty: 5 }], { storeUuid: B })

    const r = await admin('POST', '/stock/writeoffs', {
      storeUuid: A,
      reason: 'staff',
      lines: [{ stockItemId: item, qty: 2 }],
    })
    expect(r.status).toBe(201)

    const batches = db
      .prepare(`SELECT store_uuid AS s, qty_left AS q FROM stock_batches WHERE stock_item_id=? ORDER BY id`)
      .all(item) as { s: string | null; q: number }[]
    expect(batches[0]).toEqual({ s: A, q: 3 })
    expect(batches[1]).toEqual({ s: B, q: 5 })
  })

  it('GET /stock/writeoffs отдаёт документ со строками', async () => {
    const item = await withStock('Читаемое', 4)
    expect((await admin('POST', '/stock/writeoffs', { reason: 'tasting', notes: 'проба', lines: [{ stockItemId: item, qty: 1 }] })).status).toBe(201)

    const list = await admin('GET', '/stock/writeoffs')
    expect(list.status).toBe(200)
    const doc = list.json.writeoffs[0]
    expect(doc.reason).toBe('tasting')
    expect(doc.notes).toBe('проба')
    expect(doc.lines).toHaveLength(1)
    expect(doc.lines[0]).toMatchObject({ stockItemId: item, qty: 1, unit: 'kg' })
  })

  it('позицию со списанием нельзя удалить физически — только деактивировать', async () => {
    const item = await withStock('Удаляемая', 4)
    expect((await admin('POST', '/stock/writeoffs', { reason: 'spoilage', lines: [{ stockItemId: item, qty: 1 }] })).status).toBe(201)

    const del = await admin('DELETE', `/stock/items/${item}`)
    expect(del.status).toBe(200)
    expect(del.json.deactivated).toBe(true)
    expect(del.json.linked.stock_writeoff_lines).toBe(1)
    const row = db.prepare('SELECT active FROM stock_items WHERE id=?').get(item) as { active: number }
    expect(row.active).toBe(0)
  })
})
