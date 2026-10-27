/**
 * Q-06: контракт единиц. Количество везде в `unit` позиции, автоконвертации нет (D-14);
 * норма > 2 для кг/л отклоняется (D-15); единицу нельзя менять после первого документа.
 */
import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin, createItem, createSupplier, receive } from './wh-helpers'

describe('Q-06: проверка нормы против единицы позиции', () => {
  it('норма 18 на позиции кг отклоняется, 0.018 проходит', async () => {
    const kg = await createItem('Кофе кг', 'kg')
    db.prepare(`INSERT OR REPLACE INTO products(id,name,price) VALUES(601,'Капучино',150)`).run()

    const bad = await admin('POST', '/stock/norms', { productId: 601, stockItemId: kg, qty: 18 })
    expect(bad.status).toBe(400)
    expect(bad.json.error ?? bad.json.message).toMatch(/грамм/i)

    const ok = await admin('POST', '/stock/norms', { productId: 601, stockItemId: kg, qty: 0.018 })
    expect(ok.status).toBe(200)
  })

  it('норма 18 на позиции g и 5 на pcs проходит', async () => {
    const g = await createItem('Кофе г', 'g')
    const pcs = await createItem('Стаканы', 'pcs')
    db.prepare(`INSERT OR REPLACE INTO products(id,name,price) VALUES(602,'Латте',150)`).run()

    expect((await admin('POST', '/stock/norms', { productId: 602, stockItemId: g, qty: 18 })).status).toBe(200)
    expect((await admin('POST', '/stock/norms', { productId: 602, stockItemId: pcs, qty: 5 })).status).toBe(200)
  })

  it('норма 5 на позиции l отклоняется', async () => {
    const l = await createItem('Молоко л', 'l')
    db.prepare(`INSERT OR REPLACE INTO products(id,name,price) VALUES(603,'Флэт',150)`).run()
    const r = await admin('POST', '/stock/norms', { productId: 603, stockItemId: l, qty: 5 })
    expect(r.status).toBe(400)
  })
})

describe('Q-06: рецептуры подчиняются тому же контракту', () => {
  it('PUT /stock/recipes с 18 кг отклоняется, нормы товара не меняются', async () => {
    const kg = await createItem('Рецепт кг', 'kg')
    const g = await createItem('Рецепт г', 'g')
    db.prepare(`INSERT OR REPLACE INTO products(id,name,price) VALUES(604,'Раф',150)`).run()
    expect((await admin('PUT', '/stock/recipes/604', { mode: 'raw', components: [{ stockItemId: g, qty: 20 }] })).status).toBe(200)

    const bad = await admin('PUT', '/stock/recipes/604', { mode: 'raw', components: [{ stockItemId: kg, qty: 18 }] })
    expect(bad.status).toBe(400)

    const norms = db.prepare(`SELECT stock_item_id AS id, qty FROM product_stock_norms WHERE product_id=604`).all() as {
      id: number
      qty: number
    }[]
    expect(norms).toEqual([{ id: g, qty: 20 }])
  })
})

describe('Q-06: смена единицы позиции', () => {
  it('позиция без истории: единицу менять можно', async () => {
    const id = await createItem('Без истории', 'g')
    const r = await admin('PATCH', `/stock/items/${id}`, { unit: 'kg' })
    expect(r.status).toBe(200)
    expect((db.prepare('SELECT unit FROM stock_items WHERE id=?').get(id) as { unit: string }).unit).toBe('kg')
  })

  it('позиция с приходом: единицу менять нельзя, остальные поля — можно', async () => {
    const id = await createItem('С историей', 'g')
    await receive(await createSupplier('Пост единицы'), [{ stockItemId: id, qty: 5 }])

    const bad = await admin('PATCH', `/stock/items/${id}`, { unit: 'kg' })
    expect(bad.status).toBe(400)
    expect(bad.json.error ?? bad.json.message).toMatch(/Единицу нельзя менять/i)
    expect((db.prepare('SELECT unit FROM stock_items WHERE id=?').get(id) as { unit: string }).unit).toBe('g')

    const ok = await admin('PATCH', `/stock/items/${id}`, { name: 'Переименовано', minQty: 3 })
    expect(ok.status).toBe(200)
    const row = db.prepare('SELECT name, min_qty AS minQty FROM stock_items WHERE id=?').get(id) as {
      name: string
      minQty: number
    }
    expect(row).toEqual({ name: 'Переименовано', minQty: 3 })
  })
})
