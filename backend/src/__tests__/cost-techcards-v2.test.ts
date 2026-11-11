/**
 * F3–F7: API техкарт v2 — сквозные сценарии на реальной БД.
 *
 * Проверяем то, ради чего затевался план: заготовка → блюдо → версия → публикация →
 * проекция на склад → цена из накладной → сигналы → массовая замена.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin } from './wh-helpers'

async function createItem(name: string, unit: string, extra: { manualCostKop?: number } = {}) {
  const r = await admin('POST', '/stock/items', { name, kind: 'raw', unit })
  expect([200, 201]).toContain(r.status)
  const id = Number(r.json.item?.id ?? r.json.id)
  // Ручная цена ставится через /cost/items: это тот же фолбэк, что в UI.
  if (extra.manualCostKop != null) {
    const put = await admin('PUT', `/cost/items/${id}`, { manualCostRub: extra.manualCostKop / 100 })
    expect(put.status).toBe(200)
  }
  return id
}

/** Накладная + проведение — единственный легальный источник цены. */
async function receive(itemId: number, qty: number, unitCostKop: number) {
  const supplier = await admin('POST', '/suppliers', { name: `Поставщик ${Date.now()}-${Math.random()}` })
  expect([200, 201]).toContain(supplier.status)
  const supplierId = Number(supplier.json.supplier?.id ?? supplier.json.id)
  const inv = await admin('POST', '/purchases/invoices', { supplierId, lines: [{ stockItemId: itemId, qty, unitCostKop }] })
  expect([200, 201]).toContain(inv.status)
  const invoiceId = Number(inv.json.invoice?.id ?? inv.json.id)
  const posted = await admin('POST', `/purchases/invoices/${invoiceId}/post`, {})
  expect(posted.status).toBe(200)
  return invoiceId
}

beforeEach(() => {
  db.prepare(`DELETE FROM tech_card_lines`).run()
  db.prepare(`DELETE FROM tech_card_versions`).run()
  db.prepare(`DELETE FROM tech_cards`).run()
  db.prepare(`DELETE FROM stock_item_cost_history`).run()
})

describe('F3: техкарты — создание, версии, публикация', () => {
  it('создаёт карту с заготовкой и считает себестоимость по брутто', async () => {
    const bean = await createItem('Кофе зерно QA', 'g', { manualCostKop: 200 })
    const milk = await createItem('Молоко QA', 'ml', { manualCostKop: 9 })
    const cup = await createItem('Стакан QA', 'pcs', { manualCostKop: 500 })

    // заготовка: молоко взбитое из 1000 мл
    const semi = await admin('POST', '/cost/tech-cards', {
      name: 'Молоко взбитое QA',
      kind: 'semi',
      outputQty: 900,
      outputUnit: 'ml',
      lines: [{ stockItemId: milk, qtyBrutto: 1000, lossHotPct: 10 }],
    })
    expect(semi.status).toBe(200)
    const semiId = semi.json.card.id
    expect(semi.json.card.costRub).toBeCloseTo(90, 2) // 1000 мл × 0,09 ₽
    expect(semi.json.card.costPerUnitRub).toBeCloseTo(0.1, 2) // 90 ₽ / 900 мл

    const dish = await admin('POST', '/cost/tech-cards', {
      name: 'Капучино QA',
      kind: 'dish',
      outputQty: 1,
      retailPriceRub: 250,
      lines: [
        { stockItemId: bean, qtyBrutto: 18 },
        { stockItemId: cup, qtyBrutto: 1 },
        { childCardId: semiId, qtyBrutto: 150 },
      ],
    })
    expect(dish.status).toBe(200)
    const card = dish.json.card
    // 18 г × 2 ₽ + 1 шт × 5 ₽ + 150 мл × 0,1 ₽ = 36 + 5 + 15 = 56 ₽
    expect(card.costPerUnitRub).toBeCloseTo(56, 2)
    expect(card.foodCostPct).toBeCloseTo(22.4, 1)
    expect(card.marginRub).toBeCloseTo(194, 2)
    expect(card.lines).toHaveLength(3)
    expect(card.lines[2].childCardName).toBe('Молоко взбитое QA')
  })

  it('версия с датой в будущем не применяется, но видна в списке', async () => {
    const item = await createItem('Сахар QA', 'g', { manualCostKop: 1 })
    const created = await admin('POST', '/cost/tech-cards', {
      name: 'Сироп QA',
      kind: 'modifier',
      lines: [{ stockItemId: item, qtyBrutto: 10 }],
    })
    const id = created.json.card.id
    const future = Date.now() + 7 * 24 * 3600 * 1000
    const v2 = await admin('POST', `/cost/tech-cards/${id}/versions`, { validFrom: future, note: 'с декабря' })
    expect(v2.status).toBe(200)
    // Правка ИМЕННО будущей версии — иначе непонятно, что вступит в декабре.
    await admin('PUT', `/cost/tech-cards/${id}?versionId=${v2.json.versionId}`, {
      lines: [{ stockItemId: item, qtyBrutto: 20 }],
    })

    const active = await admin('GET', `/cost/tech-cards/${id}`)
    expect(active.json.card.lines[0].qtyBrutto).toBe(10) // будущая версия не вступила
    expect(active.json.card.versions.length).toBe(2)

    const futureCard = await admin('GET', `/cost/tech-cards/${id}?versionId=${v2.json.versionId}`)
    expect(futureCard.json.card.version.note).toBe('с декабря')
  })

  it('циклы заготовок запрещены', async () => {
    const a = await admin('POST', '/cost/tech-cards', { name: 'A QA', kind: 'semi' })
    const b = await admin('POST', '/cost/tech-cards', { name: 'B QA', kind: 'semi' })
    const aId = a.json.card.id
    const bId = b.json.card.id
    await admin('PUT', `/cost/tech-cards/${aId}`, { lines: [{ childCardId: bId, qtyBrutto: 1 }] })
    const loop = await admin('PUT', `/cost/tech-cards/${bId}`, { lines: [{ childCardId: aId, qtyBrutto: 1 }] })
    expect(loop.status).toBe(400)
    expect(String(loop.json.error?.message ?? loop.json.error ?? '')).toMatch(/сама в себя/)
  })

  it('публикация проецирует нормы на склад и цену в товар', async () => {
    const t = Date.now()
    const pid = Number(
      db
        .prepare(
          `INSERT INTO products(name, price, available, created_at, updated_at) VALUES(?,?,1,?,?)`,
        )
        .run('Товар проекции QA', 25000, t, t).lastInsertRowid,
    )
    const product = { id: pid, name: 'Товар проекции QA' }
    const item = await createItem('Зерно для проекции QA', 'g', { manualCostKop: 100 })
    const created = await admin('POST', '/cost/tech-cards', {
      name: 'Проекция QA',
      productId: product!.id,
      writeOffMode: 'ingredients',
      lines: [{ stockItemId: item, qtyBrutto: 12 }],
    })
    const id = created.json.card.id
    const published = await admin('POST', `/cost/tech-cards/${id}/publish`, {})
    expect(published.status).toBe(200)
    expect(published.json.projection.norms).toBe(1)

    const norms = db
      .prepare(`SELECT stock_item_id AS itemId, qty FROM product_stock_norms WHERE product_id=?`)
      .all(product!.id) as { itemId: number; qty: number }[]
    expect(norms).toEqual([{ itemId: item, qty: 12 }])
    const mode = db.prepare(`SELECT mode FROM product_recipe_modes WHERE product_id=?`).get(product!.id) as {
      mode: string
    }
    expect(mode.mode).toBe('raw')
    const cost = db.prepare(`SELECT cost_price_kopecks AS c FROM products WHERE id=?`).get(product!.id) as { c: number }
    expect(cost.c).toBe(1200) // 12 г × 1 ₽
  })
})

describe('F4: цена из накладных', () => {
  it('после проведения накладной себестоимость меняется, история пишется', async () => {
    const item = await createItem('Молоко для цены QA', 'ml')
    const before = await admin('GET', `/cost/items?q=Молоко для цены QA`)
    expect(before.json.items[0].costRub).toBeNull()
    expect(before.json.items[0].problems).toContain('нет цены')

    const invoiceId = await receive(item, 1000, 9)
    const after = await admin('GET', `/cost/items?q=Молоко для цены QA`)
    expect(after.json.items[0].costRub).toBeCloseTo(0.09, 2)
    expect(after.json.items[0].costSource).toBe('invoice')

    const history = db
      .prepare(`SELECT source, cost_kop AS costKop FROM stock_item_cost_history WHERE stock_item_id=?`)
      .all(item) as { source: string; costKop: number }[]
    expect(history.some((h) => h.source === 'invoice' && h.costKop === 9)).toBe(true)

    // вторая поставка дороже — средневзвешенная растёт
    await receive(item, 1000, 15)
    const weighted = await admin('GET', `/cost/items?q=Молоко для цены QA`)
    expect(weighted.json.items[0].costRub).toBeCloseTo(0.12, 2)

    const curve = await admin('GET', `/cost/items/${item}/price-history`)
    expect(curve.json.purchases.length).toBe(2)
    expect(curve.json.history.some((h: { source: string }) => h.source === 'invoice')).toBe(true)
    expect(invoiceId).toBeGreaterThan(0)
  })

  it('ручная цена работает как фолбэк и попадает в историю', async () => {
    const item = await createItem('Сироп для фолбэка QA', 'g')
    const put = await admin('PUT', `/cost/items/${item}`, { manualCostRub: 0.4 })
    expect(put.status).toBe(200)
    const list = await admin('GET', `/cost/items?q=Сироп для фолбэка QA`)
    expect(list.json.items[0].costRub).toBeCloseTo(0.4, 2)
    expect(list.json.items[0].costSource).toBe('manual')
  })
})

describe('F6: массовые операции', () => {
  it('замена ингредиента с коэффициентом во всех картах', async () => {
    const a = await createItem('Карамель QA', 'g', { manualCostKop: 30 })
    const b = await createItem('Карамель солёная QA', 'g', { manualCostKop: 40 })
    const c1 = await admin('POST', '/cost/tech-cards', { name: 'Карта 1 QA', lines: [{ stockItemId: a, qtyBrutto: 20 }] })
    const c2 = await admin('POST', '/cost/tech-cards', { name: 'Карта 2 QA', lines: [{ stockItemId: a, qtyBrutto: 10 }] })
    const res = await admin('POST', '/cost/bulk/replace-ingredient', {
      fromStockItemId: a,
      toStockItemId: b,
      factor: 0.9,
    })
    expect(res.status).toBe(200)
    expect(res.json.cards).toBe(2)
    const one = await admin('GET', `/cost/tech-cards/${c1.json.card.id}`)
    expect(one.json.card.lines[0].stockItemId).toBe(b)
    expect(one.json.card.lines[0].qtyBrutto).toBeCloseTo(18, 3)
    const two = await admin('GET', `/cost/tech-cards/${c2.json.card.id}`)
    expect(two.json.card.lines[0].qtyBrutto).toBeCloseTo(9, 3)
  })

  it('массовая правка потерь по выбранным картам', async () => {
    const item = await createItem('Картофель QA', 'g', { manualCostKop: 5 })
    const card = await admin('POST', '/cost/tech-cards', {
      name: 'Пюре QA',
      lines: [{ stockItemId: item, qtyBrutto: 1200 }],
    })
    const res = await admin('POST', '/cost/bulk/loss-pct', {
      cardIds: [card.json.card.id],
      lossColdPct: 33.3,
    })
    expect(res.status).toBe(200)
    const after = await admin('GET', `/cost/tech-cards/${card.json.card.id}`)
    expect(after.json.card.lines[0].lossColdPct).toBeCloseTo(33.3, 1)
    // нетто 800 г из 1200 г — как в учебнике по iiko
    expect(after.json.card.lines[0].qtyNetto).toBeCloseTo(800, 0)
  })
})

describe('F3: сигналы и сводка', () => {
  it('/cost/insights находит карту без цены и отрицательную маржу', async () => {
    const item = await createItem('Без цены QA', 'g')
    const card = await admin('POST', '/cost/tech-cards', {
      name: 'Проблемная QA',
      retailPriceRub: 10,
      lines: [{ stockItemId: item, qtyBrutto: 100 }],
    })
    const insights = await admin('GET', '/cost/insights')
    expect(insights.status).toBe(200)
    const mine = insights.json.rows.filter((r: { cardId: number }) => r.cardId === card.json.card.id)
    expect(mine.some((r: { code: string }) => r.code === 'no_cost')).toBe(true)

    await admin('PUT', `/cost/items/${item}`, { manualCostRub: 0.5 })
    const again = await admin('GET', '/cost/insights')
    const now = again.json.rows.filter((r: { cardId: number }) => r.cardId === card.json.card.id)
    expect(now.some((r: { code: string }) => r.code === 'negative_margin')).toBe(true)
  })

  it('список карт фильтруется по проблемным', async () => {
    const ok = await createItem('Хорошая цена QA', 'g', { manualCostKop: 10 })
    await admin('POST', '/cost/tech-cards', {
      name: 'Нормальная QA',
      retailPriceRub: 100,
      lines: [{ stockItemId: ok, qtyBrutto: 10 }],
    })
    const problems = await admin('GET', '/cost/tech-cards?problems=1')
    expect(problems.status).toBe(200)
    expect(problems.json.cards.every((c: { insights: unknown[] }) => c.insights.length > 0)).toBe(true)
  })
})
