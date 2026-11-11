/**
 * F12: меню-инжиниринг на реальных чеках — привязка продаж к картам, окно анализа,
 * полная себестоимость и пустое меню.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin } from './wh-helpers'

const DAY = 24 * 60 * 60 * 1000

async function createItem(name: string, unit: string, costKop: number) {
  const r = await admin('POST', '/stock/items', { name, kind: 'raw', unit })
  expect([200, 201]).toContain(r.status)
  const id = Number(r.json.item?.id ?? r.json.id)
  const put = await admin('PUT', `/cost/items/${id}`, { manualCostRub: costKop / 100 })
  expect(put.status).toBe(200)
  return id
}

async function createCard(name: string, opts: { costKop: number; priceRub: number; productId?: number }) {
  const item = await createItem(`Сырьё для ${name}`, 'g', opts.costKop)
  const r = await admin('POST', '/cost/tech-cards', {
    name,
    kind: 'dish',
    outputQty: 1,
    outputUnit: 'pcs',
    retailPriceRub: opts.priceRub,
    productId: opts.productId ?? null,
    lines: [{ stockItemId: item, qtyBrutto: 1 }],
  })
  expect(r.status).toBe(200)
  return r.json.card as { id: number; name: string }
}

/** Товар кассы: к нему цепляется карта и на него приходят продажи. */
function createProduct(name: string): number {
  const t = Date.now()
  const info = db
    .prepare(`INSERT INTO products(name, price, created_at, updated_at) VALUES(?,?,?,?)`)
    .run(name, 100_00, t, t)
  return Number(info.lastInsertRowid)
}

/** Строка чека: то, что реально приходит из Эвотора. */
function sell(opts: { name: string; qty: number; sumKop: number; productId?: number | null; daysAgo?: number }) {
  db.prepare(
    `INSERT INTO sales_lines(store_uuid, doc_id, product_id, name_snapshot, qty, sum_kopecks, closed_at)
     VALUES('s-qa', ?, ?, ?, ?, ?, ?)`,
  ).run(
    `doc-${Math.random()}`,
    opts.productId ?? null,
    opts.name,
    opts.qty,
    opts.sumKop,
    Date.now() - (opts.daysAgo ?? 0) * DAY,
  )
}

beforeEach(() => {
  db.prepare(`DELETE FROM tech_card_lines`).run()
  db.prepare(`DELETE FROM tech_card_versions`).run()
  db.prepare(`DELETE FROM tech_cards`).run()
  db.prepare(`DELETE FROM stock_item_cost_history`).run()
  db.prepare(`DELETE FROM sales_lines`).run()
  db.prepare(`DELETE FROM cost_overheads`).run()
  db.prepare(`DELETE FROM cost_settings`).run()
})

describe('F12: меню-инжиниринг', () => {
  it('пустое меню отвечает без ошибок и с подсказкой', async () => {
    const r = await admin('GET', '/cost/menu-engineering')
    expect(r.status).toBe(200)
    expect(r.json.rows).toEqual([])
    expect(r.json.totals.counted).toBe(0)
    expect(r.json.note).toMatch(/нет чеков/)
  })

  it('продажи по товару кассы дают категории и ABC', async () => {
    const pStar = createProduct('Звезда QA (касса)')
    const pDog = createProduct('Собака QA (касса)')
    const pNone = createProduct('Тишина QA (касса)')
    const star = await createCard('Звезда QA', { costKop: 2_000, priceRub: 100, productId: pStar })
    const dog = await createCard('Собака QA', { costKop: 9_500, priceRub: 100, productId: pDog })
    const none = await createCard('Тишина QA', { costKop: 1_000, priceRub: 150, productId: pNone })

    // 200 порций по 100 ₽ и 20 порций по 100 ₽ — маржа 80 ₽ и 5 ₽.
    sell({ name: 'Звезда QA', qty: 200, sumKop: 2_000_000, productId: pStar })
    sell({ name: 'Собака QA', qty: 20, sumKop: 200_000, productId: pDog })

    const r = await admin('GET', '/cost/menu-engineering?days=30')
    expect(r.status).toBe(200)
    expect(r.json.totals.cards).toBe(3)
    expect(r.json.totals.counted).toBe(2)
    expect(r.json.totals.noSales).toBe(1)
    expect(r.json.totals.revenueRub).toBe(22_000)
    expect(r.json.totals.profitRub).toBe(16_100) // 200×80 + 20×5
    expect(r.json.thresholds.popularityQty).toBeCloseTo(77, 0) // 0,7 × 220 / 2

    const byName = new Map<string, any>(r.json.rows.map((x: any) => [x.name, x]))
    expect(byName.get('Звезда QA').category).toBe('star')
    expect(byName.get('Звезда QA').abcRevenue).toBe('A')
    expect(byName.get('Звезда QA').marginPerUnitRub).toBeCloseTo(80, 2)
    expect(byName.get('Собака QA').category).toBe('dog')
    expect(byName.get('Тишина QA').category).toBe('none')
    expect(byName.get('Тишина QA').reason).toMatch(/нет продаж/)
    // Непроданная карта — в конце списка.
    expect(r.json.rows.at(-1).name).toBe('Тишина QA')
    expect([star.id, dog.id, none.id]).toHaveLength(3)
  })

  it('без привязки к товару кассы продажи находятся по имени', async () => {
    await createCard('Латте по имени QA', { costKop: 3_000, priceRub: 200 })
    // В чеке регистр и пробелы другие: имя из чека должно совпасть с картой.
    sell({ name: '  ЛАТТЕ ПО ИМЕНИ qa ', qty: 10, sumKop: 200_000, productId: null })

    const r = await admin('GET', '/cost/menu-engineering')
    expect(r.json.totals.counted).toBe(1)
    expect(r.json.totals.qtySold).toBe(10)
    expect(r.json.rows[0].revenueRub).toBe(2_000)
    expect(r.json.rows[0].profitRub).toBe(1_700) // 10 × (200 − 30)
  })

  it('окно анализа отсекает старые чеки', async () => {
    const pOld = createProduct('Старая продажа QA (касса)')
    await createCard('Старая продажа QA', { costKop: 1_000, priceRub: 100, productId: pOld })
    sell({ name: 'Старая продажа QA', qty: 50, sumKop: 500_000, productId: pOld, daysAgo: 40 })

    const fresh = await admin('GET', '/cost/menu-engineering?days=30')
    expect(fresh.json.totals.counted).toBe(0)
    expect(fresh.json.totals.noSales).toBe(1)

    const wide = await admin('GET', '/cost/menu-engineering?days=60')
    expect(wide.json.totals.counted).toBe(1)
    expect(wide.json.totals.qtySold).toBe(50)
  })

  it('с включёнными постоянными расходами маржа считается по полной себестоимости', async () => {
    const pFull = createProduct('С расходами QA (касса)')
    await createCard('С расходами QA', { costKop: 2_000, priceRub: 300, productId: pFull })
    sell({ name: 'С расходами QA', qty: 10, sumKop: 300_000, productId: pFull })

    // 10 000 ₽ зарплаты на 100 порций плана = 100 ₽ на порцию.
    await admin('POST', '/cost/overheads', { name: 'Зарплата QA', kind: 'salary', amountRub: 10_000 })
    await admin('PUT', '/cost/settings', { enabled: true, allocation: 'units', plannedUnitsPerMonth: 100 })

    const full = await admin('GET', '/cost/menu-engineering')
    expect(full.json.overheadEnabled).toBe(true)
    expect(full.json.costBasis).toBe('full')
    // База — фактические продажи: 10 000 ₽ расходов / 10 порций = 1000 ₽ на порцию.
    // Сырьё 20 ₽ → полная 1020 ₽, маржа 300 − 1020 = −720 ₽ (позиция убыточна).
    expect(full.json.rows[0].costPerUnitRub).toBeCloseTo(1_020, 2)
    expect(full.json.rows[0].marginPerUnitRub).toBeCloseTo(-720, 2)

    await admin('PUT', '/cost/settings', { enabled: false })
    const raw = await admin('GET', '/cost/menu-engineering')
    expect(raw.json.costBasis).toBe('raw')
    // Без расходов маржа 300 − 20 = 280 ₽.
    expect(raw.json.rows[0].marginPerUnitRub).toBeCloseTo(280, 2)
  })

  it('карта без себестоимости попадает в список с причиной, а не ломает анализ', async () => {
    // Сырьё без цены: себестоимость не считается — это и есть «нет себестоимости».
    const bare = await admin('POST', '/stock/items', { name: 'Сырьё без цены QA', kind: 'raw', unit: 'g' })
    const bareId = Number(bare.json.item?.id ?? bare.json.id)
    const r0 = await admin('POST', '/cost/tech-cards', {
      name: 'Без цены QA',
      kind: 'dish',
      outputQty: 1,
      retailPriceRub: 150,
      lines: [{ stockItemId: bareId, qtyBrutto: 10 }],
    })
    expect(r0.status).toBe(200)
    sell({ name: 'Без цены QA', qty: 10, sumKop: 150_000 })

    const r = await admin('GET', '/cost/menu-engineering')
    expect(r.json.totals.noCost).toBe(1)
    expect(r.json.totals.counted).toBe(0)
    expect(r.json.rows[0].category).toBe('none')
    expect(r.json.rows[0].reason).toMatch(/себестоимость/)
  })
})
