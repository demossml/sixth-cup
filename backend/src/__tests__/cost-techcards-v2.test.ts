/**
 * F3–F7: API техкарт v2 — сквозные сценарии на реальной БД.
 *
 * Проверяем то, ради чего затевался план: заготовка → блюдо → версия → публикация →
 * проекция на склад → цена из накладной → сигналы → массовая замена.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app'
import { config } from '../config'
import { db } from '../db'
import { lastInventoryAt } from '../modules/admin/costTechCards'
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

/** Товар каталога для привязки карты (цена 0 — розница берётся из карты). */
function makeProduct(name: string): number {
  const t = Date.now()
  return Number(
    db.prepare(`INSERT INTO products(name, price, available, created_at, updated_at) VALUES(?,?,1,?,?)`)
      .run(`${name} (товар)`, 0, t, t).lastInsertRowid,
  )
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
  it('списывает только полные партии эспрессо и переносит их расход на склад', async () => {
    const beans = await createItem('Кофейные зёрна двойной партии QA', 'g', { manualCostKop: 174 })
    const espressoBatch = await admin('POST', '/cost/tech-cards', {
      name: 'Эспрессо партия QA',
      kind: 'semi',
      outputQty: 2,
      outputUnit: 'pcs',
      portionMode: 'whole_batch',
      lines: [{ stockItemId: beans, qtyBrutto: 18 }],
    })
    expect(espressoBatch.status).toBe(200)
    const batch = espressoBatch.json.card
    expect(batch).toMatchObject({
      outputQty: 2,
      outputUnit: 'pcs',
      portionMode: 'whole_batch',
      costRub: 31.32,
      costPerUnitRub: 15.66,
    })

    for (const [shots, expectedCost] of [[1, 31.32], [2, 31.32], [3, 62.64], [4, 62.64]]) {
      const productId = makeProduct(`Напиток ${shots} шота партия QA`)
      const drink = await admin('POST', '/cost/tech-cards', {
        name: `Напиток ${shots} шота партия QA`,
        kind: 'dish',
        productId,
        lines: [{ childCardId: batch.id, qtyBrutto: shots }],
      })
      expect(drink.status).toBe(200)
      expect(drink.json.card.costPerUnitRub).toBe(expectedCost)
      expect(drink.json.card.lines[0].lineCostRub).toBe(expectedCost)

      const published = await admin('POST', `/cost/tech-cards/${drink.json.card.id}/publish`, {})
      expect(published.status).toBe(200)
      expect(published.json.projection.norms).toBe(1)
      const norms = db
        .prepare(`SELECT qty FROM product_stock_norms WHERE product_id=? AND stock_item_id=?`)
        .get(productId, beans) as { qty: number } | undefined
      expect(norms?.qty).toBe(Math.ceil(shots / 2) * 18)
    }

    const invalidDish = await admin('POST', '/cost/tech-cards', {
      name: 'Некорректная партия QA',
      kind: 'dish',
      productId: makeProduct('Некорректная партия QA'),
      portionMode: 'whole_batch',
    })
    expect(invalidDish.status).toBe(400)
  })

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
      productId: makeProduct('Капучино QA'),
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

  it('цена и наценка карты перекрывают цену меню и сразу меняют маржу', async () => {
    const bean = await createItem('Кофе для цены QA', 'g', { manualCostKop: 200 })
    const productId = makeProduct('Цена QA')
    db.prepare(`UPDATE products SET price=? WHERE id=?`).run(250, productId)

    // По умолчанию цена берётся из меню — прежнее поведение сохраняется.
    const fromMenu = await admin('POST', '/cost/tech-cards', {
      name: 'Цена из меню QA',
      kind: 'dish',
      productId,
      lines: [{ stockItemId: bean, qtyBrutto: 10 }],
    })
    expect(fromMenu.json.card.retailSource).toBe('catalog')
    expect(fromMenu.json.card.retailRub).toBeCloseTo(250, 2)
    expect(fromMenu.json.card.marginRub).toBeCloseTo(230, 2)

    const manual = await admin('POST', '/cost/tech-cards', {
      name: 'Своя цена QA',
      kind: 'dish',
      productId,
      retailMode: 'manual',
      retailPriceRub: 320,
      lines: [{ stockItemId: bean, qtyBrutto: 10 }],
    })
    expect(manual.json.card.retailSource).toBe('card')
    expect(manual.json.card.retailRub).toBeCloseTo(320, 2)
    expect(manual.json.card.marginRub).toBeCloseTo(300, 2)
    expect(manual.json.card.foodCostPct).toBeCloseTo(6.3, 1)

    // Наценка 300 % от себестоимости 20 ₽ даёт 80 ₽.
    const markup = await admin('POST', '/cost/tech-cards', {
      name: 'Наценка QA',
      kind: 'dish',
      productId,
      retailMode: 'markup',
      markupPct: 300,
      lines: [{ stockItemId: bean, qtyBrutto: 10 }],
    })
    expect(markup.json.card.retailSource).toBe('markup')
    expect(markup.json.card.retailRub).toBeCloseTo(80, 2)
    expect(markup.json.card.marginRub).toBeCloseTo(60, 2)

    const switched = await admin('PUT', `/cost/tech-cards/${fromMenu.json.card.id}`, {
      retailMode: 'manual',
      retailPriceRub: 300,
    })
    expect(switched.status).toBe(200)
    expect(switched.json.card.retailRub).toBeCloseTo(300, 2)
    expect(switched.json.card.marginRub).toBeCloseTo(280, 2)
  })

  it('версия с датой в будущем не применяется, но видна в списке', async () => {
    const item = await createItem('Сахар QA', 'g', { manualCostKop: 1 })
    const created = await admin('POST', '/cost/tech-cards', {
      name: 'Сироп QA',
      kind: 'modifier',
      productId: makeProduct('Сироп QA'),
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

  it('упаковка сохраняет точную долю цены и ручной override перекрывает закупки', async () => {
    const item = await createItem('Сироп 750 мл QA', 'ml')
    await receive(item, 750, 20)
    const update = await admin('PUT', `/cost/items/${item}`, {
      packageQty: 750,
      packagePriceRub: 100,
      priceMode: 'manual',
    })
    expect(update.status).toBe(200)

    const listed = await admin('GET', `/cost/items?q=Сироп 750 мл QA`)
    expect(listed.json.items[0].packageQty).toBe(750)
    expect(listed.json.items[0].packagePriceRub).toBe(100)
    expect(listed.json.items[0].costRub).toBeCloseTo(100 / 750, 6)
    expect(listed.json.items[0].costSource).toBe('manual')

    const card = await admin('POST', '/cost/tech-cards', {
      name: 'Напиток с сиропом QA',
      productId: makeProduct('Напиток с сиропом QA'),
      lines: [{ stockItemId: item, qtyBrutto: 75 }],
    })
    expect(card.json.card.costPerUnitRub).toBe(10)

    const auto = await admin('PUT', `/cost/items/${item}`, { priceMode: 'auto' })
    expect(auto.status).toBe(200)
    const autoCard = await admin('GET', `/cost/tech-cards/${card.json.card.id}`)
    expect(autoCard.json.card.costPerUnitRub).toBe(15)
  })

  it('не допускает менять единицу ингредиента, используемого в техкарте', async () => {
    const item = await createItem('Молоко единицы QA', 'ml', { manualCostKop: 10 })
    await admin('POST', '/cost/tech-cards', {
      name: 'Карта единиц QA',
      productId: makeProduct('Карта единиц QA'),
      lines: [{ stockItemId: item, qtyBrutto: 100 }],
    })
    const changed = await admin('PATCH', `/stock/items/${item}`, { unit: 'g' })
    expect(changed.status).toBe(400)
    const unchanged = await admin('GET', `/stock/items/${item}`)
    expect(unchanged.json.item.unit).toBe('ml')
  })

  it('не допускает менять единицу через себестоимость, если есть складская партия', async () => {
    const item = await createItem('Сироп партия QA', 'ml')
    db.prepare(
      `INSERT INTO stock_batches(stock_item_id, qty_in, qty_left, unit_cost_kop, source_type, created_at)
       VALUES(?, 750, 750, 0, 'purchase', ?)`,
    ).run(item, Date.now())

    const changed = await admin('PUT', `/cost/items/${item}`, { unit: 'g' })
    expect(changed.status).toBe(400)
    const unchanged = await admin('GET', `/stock/items/${item}`)
    expect(unchanged.json.item.unit).toBe('ml')
  })

  it('снимает предупреждение о переносе после ручного ввода фасовки', async () => {
    const item = await createItem('Сироп перенос QA', 'ml')
    db.prepare(
      `INSERT INTO cost_price_migration_conflicts(
         cost_ingredient_id, stock_item_id, old_pack_qty, old_pack_price_kop,
         existing_manual_cost_kop, reason, created_at
       ) VALUES(999, ?, 750, 10000, NULL, 'test', ?)`,
    ).run(item, Date.now())

    const saved = await admin('PUT', `/cost/items/${item}`, {
      packageQty: 750,
      packagePriceRub: 100,
      priceMode: 'manual',
    })
    expect(saved.status).toBe(200)
    const remaining = db
      .prepare(`SELECT COUNT(*) AS n FROM cost_price_migration_conflicts WHERE stock_item_id=?`)
      .get(item) as { n: number }
    expect(remaining.n).toBe(0)
  })

  it('использует время последней только проведённой полной инвентаризации', () => {
    const base = Date.now()
    const insert = db.prepare(
      `INSERT INTO inventory_docs(kind, status, created_at, updated_at, posted_at) VALUES(?,?,?,?,?)`,
    )
    insert.run('full', 'posted', base - 5000, base - 5000, base - 4000)
    insert.run('full', 'review', base - 3000, base - 3000, null)
    insert.run('full', 'cancelled', base - 2000, base - 2000, null)
    insert.run('partial', 'posted', base - 1000, base - 1000, base - 500)
    expect(lastInventoryAt()).toBe(base - 4000)
  })
})

describe('F6: массовые операции', () => {
  it('замена ингредиента с коэффициентом во всех картах', async () => {
    const a = await createItem('Карамель QA', 'g', { manualCostKop: 30 })
    const b = await createItem('Карамель солёная QA', 'g', { manualCostKop: 40 })
    const c1 = await admin('POST', '/cost/tech-cards', { name: 'Карта 1 QA', productId: makeProduct('Карта 1 QA'), lines: [{ stockItemId: a, qtyBrutto: 20 }] })
    const c2 = await admin('POST', '/cost/tech-cards', { name: 'Карта 2 QA', productId: makeProduct('Карта 2 QA'), lines: [{ stockItemId: a, qtyBrutto: 10 }] })
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
      productId: makeProduct('Пюре QA'),
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
  it('не публикует частичную стоимость карты, если нет цены у обязательного ингредиента', async () => {
    const known = await createItem('Кофе известная цена QA', 'g', { manualCostKop: 200 })
    const missing = await createItem('Ингредиент без цены QA', 'ml')
    const created = await admin('POST', '/cost/tech-cards', {
      name: 'Неполная карта QA',
      productId: makeProduct('Неполная карта QA'),
      lines: [
        { stockItemId: known, qtyBrutto: 18 },
        { stockItemId: missing, qtyBrutto: 150 },
      ],
    })
    expect(created.status).toBe(200)
    expect(created.json.card.costRub).toBeNull()
    expect(created.json.card.costPerUnitRub).toBeNull()
    expect(created.json.card.missingPrices).toBe(true)
    expect(created.json.card.insights.some((i: { code: string }) => i.code === 'no_price')).toBe(true)
  })

  it('/cost/insights находит карту без цены и отрицательную маржу', async () => {
    const item = await createItem('Без цены QA', 'g')
    const card = await admin('POST', '/cost/tech-cards', {
      name: 'Проблемная QA',
      productId: makeProduct('Проблемная QA'),
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
      productId: makeProduct('Нормальная QA'),
      retailPriceRub: 100,
      lines: [{ stockItemId: ok, qtyBrutto: 10 }],
    })
    const problems = await admin('GET', '/cost/tech-cards?problems=1')
    expect(problems.status).toBe(200)
    expect(problems.json.cards.every((c: { insights: unknown[] }) => c.insights.length > 0)).toBe(true)
  })
})

describe('F9: импорт пишет в модель v2, а не в cost_*', () => {
  it('текст техкарты создаёт позиции склада и карту с составом', async () => {
    const r = await admin('POST', '/cost/import/techcards-text', {
      text: 'КАПУЧИНО ИМПОРТ QA\nкофе молотый — 10 г\nмолоко — 150 мл\nстакан 200 мл — 1 шт',
    })
    expect(r.status).toBe(200)
    expect(r.json.cardsCreated).toBe(1)
    expect(r.json.itemsCreated).toBeGreaterThanOrEqual(3)

    const card = db
      .prepare(`SELECT id, status FROM tech_cards WHERE name='КАПУЧИНО ИМПОРТ QA'`)
      .get() as { id: number; status: string }
    expect(card.status).toBe('draft')
    const lines = db
      .prepare(`SELECT COUNT(*) AS n FROM tech_card_lines l JOIN tech_card_versions v ON v.id=l.version_id WHERE v.card_id=?`)
      .get(card.id) as { n: number }
    expect(lines.n).toBe(3)

    // Старые таблицы не тронуты — в них по-прежнему пусто.
    const legacy = db.prepare(`SELECT COUNT(*) AS n FROM cost_recipes`).get() as { n: number }
    expect(legacy.n).toBe(0)
  })

  it('ИИ-прайс сохраняет фасовку и точную цену упаковки', async () => {
    const r = await admin('POST', '/cost/import/items-bulk', {
      items: [{ name: 'Молоко ИИ QA', unit: 'ml', packQty: 1000, packPriceRub: 95 }],
    })
    expect(r.status).toBe(200)
    expect(r.json.created).toBe(1)
    const item = db
      .prepare(
        `SELECT unit, manual_cost_kop AS unitCost, package_qty AS packageQty,
                package_price_kop AS packagePrice, price_mode AS priceMode
           FROM stock_items WHERE name='Молоко ИИ QA'`,
      )
      .get() as {
      unit: string
      unitCost: number | null
      packageQty: number
      packagePrice: number
      priceMode: string
    }
    expect(item).toEqual({
      unit: 'ml',
      unitCost: null,
      packageQty: 1000,
      packagePrice: 9500,
      priceMode: 'manual',
    })
    const cost = await admin('GET', `/cost/items?q=${encodeURIComponent('Молоко ИИ QA')}`)
    expect(cost.json.items[0].costRub).toBeCloseTo(0.095, 6)
  })

  it('предпросмотр прайса не пишет в базу и сопоставляет точный дубль', async () => {
    db.prepare(
      `INSERT INTO app_settings(key, value, updated_at) VALUES('ai_enabled','0',?)
       ON CONFLICT(key) DO UPDATE SET value='0', updated_at=excluded.updated_at`,
    ).run(Date.now())
    const existing = await createItem('Сироп Кокос (COCO.IN)', 'ml')
    const source = 'Состав заказа:\nСироп Кокос (COCO.IN) 0,7 - 2 шт x 810 ₽'

    const preview = await admin('POST', '/cost/items/import/preview', { text: source })
    expect(preview.status).toBe(200)
    expect(preview.json.provider).toBe('heuristic')
    expect(preview.json.items[0]).toMatchObject({
      name: 'Сироп Кокос (COCO.IN)',
      unit: 'ml',
      packQty: 700,
      packPriceRub: 810,
      orderQty: 2,
      matches: [{ id: existing, exact: true }],
    })
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM stock_items WHERE name LIKE 'Сироп Кокос%'`).get() as { n: number }).n
    expect(count).toBe(1)
  })

  it('принимает CSV как файл, извлекает строки и оставляет запись только на подтверждение', async () => {
    db.prepare(
      `INSERT INTO app_settings(key, value, updated_at) VALUES('ai_enabled','0',?)
       ON CONFLICT(key) DO UPDATE SET value='0', updated_at=excluded.updated_at`,
    ).run(Date.now())
    const form = new FormData()
    form.set('file', new Blob(['name;pack;qty;price\nСироп Тест CSV;0,7 л;2 шт;810 ₽'], { type: 'text/csv' }), 'syrup.csv')
    const response = await app.request('/api/admin/cost/items/import/preview', {
      method: 'POST',
      headers: { 'X-Admin-Token': config.adminToken },
      body: form,
    })
    const result = await response.json() as { items: { name: string; packQty: number; packPriceRub: number; orderQty: number }[] }

    expect(response.status).toBe(200)
    expect(result.items[0]).toMatchObject({
      name: 'Сироп Тест CSV',
      packQty: 700,
      packPriceRub: 810,
      orderQty: 2,
    })
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM stock_items WHERE name='Сироп Тест CSV'`).get() as { n: number }).n
    expect(count).toBe(0)
  })

  it('сохраняет только подтверждённые строки, обновляет выбранную позицию и не приходует заказ', async () => {
    const existing = await createItem('Сироп Ваниль импорт QA', 'ml')
    const saved = await admin('POST', '/cost/items/import/confirm', {
      items: [
        {
          action: 'update',
          stockItemId: existing,
          name: 'Сироп Ваниль импорт QA',
          unit: 'ml',
          packageQty: 700,
          packagePriceRub: 810,
        },
        { action: 'skip' },
        {
          action: 'create',
          name: 'Сироп Кокос новый импорт QA',
          unit: 'ml',
          packageQty: 700,
          packagePriceRub: 810,
        },
      ],
    })
    expect(saved.status).toBe(200)
    expect(saved.json).toEqual({ created: 1, updated: 1, skipped: 1 })

    const values = db
      .prepare(`SELECT package_qty AS qty, package_price_kop AS price, manual_cost_kop AS direct
                  FROM stock_items WHERE id=?`)
      .get(existing) as { qty: number; price: number; direct: number | null }
    expect(values).toEqual({ qty: 700, price: 81000, direct: null })
    const invoices = (db.prepare(`SELECT COUNT(*) AS n FROM purchase_invoice_lines WHERE stock_item_id=?`).get(existing) as { n: number }).n
    const movements = (db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE stock_item_id=?`).get(existing) as { n: number }).n
    expect(invoices).toBe(0)
    expect(movements).toBe(0)
  })

  it('rejects updating an existing ingredient through a unit mismatch', async () => {
    const existing = await createItem('Сироп единицы импорта QA', 'ml')
    const result = await admin('POST', '/cost/items/import/confirm', {
      items: [{
        action: 'update',
        stockItemId: existing,
        name: 'Сироп единицы импорта QA',
        unit: 'g',
        packageQty: 700,
        packagePriceRub: 810,
      }],
    })
    expect(result.status).toBe(400)
    const unchanged = db.prepare(`SELECT unit FROM stock_items WHERE id=?`).get(existing) as { unit: string }
    expect(unchanged.unit).toBe('ml')
  })
})

describe('F10: склейка дублей позиций', () => {
  it('находит группу дублей и предлагает оставить самую используемую', async () => {
    const a = await createItem('Дубль Молоко QA', 'ml', { manualCostKop: 9 })
    const b = await createItem('дубль молоко QA', 'ml', { manualCostKop: 12 })
    const card = await admin('POST', '/cost/tech-cards', { name: 'Дубль карта QA', productId: makeProduct('Дубль карта QA'), lines: [{ stockItemId: b, qtyBrutto: 50 }] })
    expect(card.status).toBe(200)

    const dup = await admin('GET', '/cost/items/duplicates')
    expect(dup.status).toBe(200)
    const group = dup.json.groups.find((g: { name: string }) => /дубль молоко qa/i.test(g.name))
    expect(group.items).toHaveLength(2)
    expect(group.suggestedKeepId).toBe(b) // у b есть карта

    const merged = await admin('POST', '/cost/items/merge', { keepId: b, mergeIds: [a] })
    expect(merged.status).toBe(200)
    expect(merged.json.merged).toBe(1)
    const left = db.prepare(`SELECT COUNT(*) AS n FROM stock_items WHERE lower(name)='дубль молоко qa'`).get() as { n: number }
    expect(left.n).toBe(1)
    // карта смотрит на оставшуюся позицию
    const line = db
      .prepare(
        `SELECT l.stock_item_id AS itemId FROM tech_card_lines l JOIN tech_card_versions v ON v.id=l.version_id WHERE v.card_id=?`,
      )
      .get(card.json.card.id) as { itemId: number }
    expect(line.itemId).toBe(b)
  })

  it('переносит поставки: средневзвешенная считается по обеим позициям', async () => {
    const a = await createItem('Дубль Сироп QA', 'g')
    const b = await createItem('дубль сироп QA', 'g')
    await receive(a, 100, 20)
    await receive(b, 100, 40)
    const merged = await admin('POST', '/cost/items/merge', { keepId: b, mergeIds: [a] })
    expect(merged.json.moved.invoices).toBe(1)
    const list = await admin('GET', '/cost/items?q=дубль сироп QA')
    expect(list.json.items).toHaveLength(1)
    expect(list.json.items[0].costRub).toBeCloseTo(0.3, 2) // (100×0,2 + 100×0,4) / 200
  })

  it('разные единицы и разные имена склеить нельзя', async () => {
    const g = await createItem('Дубль Вес QA', 'g')
    const ml = await createItem('Дубль Вес QA', 'ml')
    const bad1 = await admin('POST', '/cost/items/merge', { keepId: g, mergeIds: [ml] })
    expect(bad1.status).toBe(400)
    expect(String(bad1.json.error?.message ?? bad1.json.error ?? '')).toMatch(/разные единицы/)

    const other = await createItem('Совсем другое QA', 'g')
    const bad2 = await admin('POST', '/cost/items/merge', { keepId: g, mergeIds: [other] })
    expect(bad2.status).toBe(400)
  })
})

describe('F11: постоянные расходы и флаг учёта', () => {
  async function setOverheads(amounts: Record<string, number>) {
    const list = await admin('GET', '/cost/overheads')
    for (const row of list.json.rows) {
      const amount = amounts[row.name]
      if (amount != null) await admin('PUT', `/cost/overheads/${row.id}`, { amountRub: amount })
    }
  }

  async function resetOverheads() {
    const list = await admin('GET', '/cost/overheads')
    for (const row of list.json.rows) await admin('PUT', `/cost/overheads/${row.id}`, { amountRub: 0 })
    await admin('PUT', '/cost/settings', { enabled: true, allocation: 'units', plannedUnitsPerMonth: 0 })
  }

  it('расходы месяца раскладываются на план продаж и попадают в полную себестоимость', async () => {
    await resetOverheads()
    await setOverheads({ Электричество: 10000, Зарплата: 90000, Аренда: 150000, Налоги: 40000 })
    // 290 000 ₽ на 1000 единиц = 290 ₽ на порцию
    await admin('PUT', '/cost/settings', { enabled: true, plannedUnitsPerMonth: 1000 })

    const ctx = await admin('GET', '/cost/overheads')
    expect(ctx.json.totalRub).toBe(290000)
    expect(ctx.json.enabled).toBe(true)
    expect(ctx.json.perUnitRub).toBe(290)
    expect(ctx.json.basisLabel).toMatch(/по плану/)

    const item = await createItem('Зерно для расходов QA', 'g', { manualCostKop: 200 })
    const card = await admin('POST', '/cost/tech-cards', {
      name: 'Карта с расходами QA',
      productId: makeProduct('Карта с расходами QA'),
      retailPriceRub: 500,
      lines: [{ stockItemId: item, qtyBrutto: 10 }],
    })
    // сырьё 10 г × 2 ₽ = 20 ₽; полная = 20 + 290 = 310 ₽ из 500 ₽
    expect(card.json.card.costPerUnitRub).toBeCloseTo(20, 2)
    expect(card.json.card.overheadPerUnitRub).toBeCloseTo(290, 2)
    expect(card.json.card.fullCostPerUnitRub).toBeCloseTo(310, 2)
    expect(card.json.card.fullFoodCostPct).toBeCloseTo(62, 1)
    expect(card.json.card.fullMarginRub).toBeCloseTo(190, 2)
  })

  it('флаг выключен — статьи остаются, но в себестоимость не входят', async () => {
    const item = await createItem('Зерно флага QA', 'g', { manualCostKop: 200 })
    const card = await admin('POST', '/cost/tech-cards', {
      name: 'Карта флага QA',
      productId: makeProduct('Карта флага QA'),
      retailPriceRub: 500,
      lines: [{ stockItemId: item, qtyBrutto: 10 }],
    })
    expect(card.status).toBe(200)
    await admin('PUT', '/cost/settings', { allocation: 'units', plannedUnitsPerMonth: 1000 })

    const on = await admin('GET', '/cost/tech-cards?q=Карта флага QA')
    expect(on.json.cards[0].overheadPerUnitRub).toBeCloseTo(290, 2)
    expect(on.json.cards[0].fullCostPerUnitRub).toBeCloseTo(310, 2)

    await admin('PUT', '/cost/settings', { enabled: false })
    const ctx = await admin('GET', '/cost/overheads')
    expect(ctx.json.totalRub).toBe(290000) // суммы на месте
    expect(ctx.json.enabled).toBe(false)
    expect(ctx.json.appliedPerUnitRub).toBeNull()

    const off = await admin('GET', '/cost/tech-cards?q=Карта флага QA')
    expect(off.json.cards[0].overheadPerUnitRub).toBeNull()
    expect(off.json.cards[0].fullCostPerUnitRub).toBeCloseTo(20, 2)
    expect(off.json.cards[0].fullFoodCostPct).toBeCloseTo(4, 1)

    await admin('PUT', '/cost/settings', { enabled: true })
    const back = await admin('GET', '/cost/tech-cards?q=Карта флага QA')
    expect(back.json.cards[0].overheadPerUnitRub).toBeCloseTo(290, 2)
  })

  it('режим «по выручке»: дорогая позиция забирает больше постоянных', async () => {
    const item = await createItem('Зерно выручка QA', 'g', { manualCostKop: 100 })
    const cheap = await admin('POST', '/cost/tech-cards', {
      name: 'Дешёвая QA',
      productId: makeProduct('Дешёвая QA'),
      retailPriceRub: 100,
      lines: [{ stockItemId: item, qtyBrutto: 10 }],
    })
    const pricey = await admin('POST', '/cost/tech-cards', {
      name: 'Дорогая QA',
      productId: makeProduct('Дорогая QA'),
      retailPriceRub: 400,
      lines: [{ stockItemId: item, qtyBrutto: 10 }],
    })
    // Реальная база — выручка: дешёвая позиция продана 100 раз на 10 000 ₽.
    const t = Date.now()
    db.prepare(
      `INSERT INTO sales_lines(store_uuid, doc_id, product_id, name_snapshot, qty, sum_kopecks, closed_at)
       VALUES('s1','d1',?, 'Дешёвая QA', 100, 1000000, ?)`,
    ).run(cheap.json.card.id, t)

    await admin('PUT', '/cost/settings', { allocation: 'revenue', enabled: true, plannedUnitsPerMonth: 0 })
    const ctx = await admin('GET', '/cost/overheads')
    expect(ctx.json.basisLabel).toMatch(/по продажам/)
    expect(ctx.json.revenueRub).toBe(10000)

    const cheapCard = await admin('GET', `/cost/tech-cards/${cheap.json.card.id}`)
    const priceyCard = await admin('GET', `/cost/tech-cards/${pricey.json.card.id}`)
    // 100 ₽ из 10 000 ₽ → 1 % расходов; 400 ₽ → 4 %
    expect(cheapCard.json.card.overheadPerUnitRub).toBeCloseTo(2900, 0)
    expect(priceyCard.json.card.overheadPerUnitRub).toBeCloseTo(11600, 0)
    expect(priceyCard.json.card.overheadPerUnitRub).toBeGreaterThan(cheapCard.json.card.overheadPerUnitRub)
    await admin('PUT', '/cost/settings', { allocation: 'units', plannedUnitsPerMonth: 0 })
    await resetOverheads()
  })

  it('ответы мутаций «Расходов» в том же формате, что и чтение (UI не теряет цифры)', async () => {
    // База — план: убираем продажи, оставшиеся от предыдущей проверки.
    db.prepare(`DELETE FROM sales_lines WHERE name_snapshot LIKE '%QA%'`).run()
    await resetOverheads()
    await admin('PUT', '/cost/settings', { allocation: 'units', plannedUnitsPerMonth: 500 })
    const rows = (await admin('GET', '/cost/overheads')).json.rows as { id: number; name: string; kind: string }[]
    const rent = rows.find((r) => r.kind === 'rent')!
    const put = await admin('PUT', `/cost/overheads/${rent.id}`, { amountRub: 50000 })
    expect(put.status).toBe(200)
    const state = put.json.overheads
    // Те же поля, что отдаёт GET: суммы в рублях и расход на порцию.
    expect(state.totalRub).toBe(50000)
    expect(state.perUnitRub).toBe(100)
    expect(state.appliedPerUnitRub).toBe(100)
    expect(state.rows.find((r: { kind: string }) => r.kind === 'rent')!.amountRub).toBe(50000)
    expect(state.basisLabel).toMatch(/по плану/)

    const created = await admin('POST', '/cost/overheads', { name: 'QA интернет', amountRub: 1000, kind: 'other' })
    expect(created.status).toBe(200)
    expect(created.json.overheads.totalRub).toBe(51000)
    expect(created.json.overheads.perUnitRub).toBe(102)

    const removed = await admin('DELETE', `/cost/overheads/${created.json.id}`)
    expect(removed.json.overheads.totalRub).toBe(50000)

    const toggled = await admin('PUT', '/cost/settings', { enabled: false })
    expect(toggled.json.overheads.perUnitRub).toBe(100)
    expect(toggled.json.overheads.appliedPerUnitRub).toBeNull()

    // Сводка показывает владельцу, заполнены ли аренда/зарплата/налоги: там же кнопка «Указать суммы».
    const filledOverview = await admin('GET', '/cost/overview')
    expect(filledOverview.json.overhead.filled).toBe(true)
    expect(filledOverview.json.overhead.totalRub).toBe(50000)

    await admin('PUT', '/cost/settings', { enabled: true, plannedUnitsPerMonth: 0 })
    await resetOverheads()

    const emptyOverview = await admin('GET', '/cost/overview')
    expect(emptyOverview.json.overhead.filled).toBe(false)
    expect(emptyOverview.json.overhead.totalRub).toBe(0)
    expect(emptyOverview.json.overhead.perUnitRub).toBeNull()
  })
})
