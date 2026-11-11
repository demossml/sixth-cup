import { describe, expect, it } from 'vitest'

import {
  allocateOverheads,
  cardInsights,
  cardTotals,
  convertQty,
  costPerUnitKop,
  findCycle,
  foodCostPct,
  marginKop,
  menuEngineering,
  overheadPerUnit,
  priceWindowStart,
  projectNorms,
  resolveLine,
  resolveYield,
  retailFromMarkup,
  unitsFromWeights,
  weightedCostKop,
} from './costCalc'

const DAY = 24 * 60 * 60 * 1000

describe('F2: единицы и конверсии', () => {
  it('кг ↔ г, л ↔ мл в одной группе', () => {
    expect(convertQty(1, 'kg', 'g', { unit: 'g' })).toBe(1000)
    expect(convertQty(250, 'g', 'kg', { unit: 'kg' })).toBe(0.25)
    expect(convertQty(1.5, 'l', 'ml', { unit: 'ml' })).toBe(1500)
  })

  it('литры → кг через плотность (молоко 1,03)', () => {
    expect(convertQty(1, 'l', 'kg', { unit: 'kg', densityKgL: 1.03 })).toBeCloseTo(1.03, 5)
    expect(convertQty(1000, 'ml', 'g', { unit: 'g', densityKgL: 1.03 })).toBeCloseTo(1030, 5)
  })

  it('штуки → граммы только при известном весе штуки', () => {
    expect(convertQty(2, 'pcs', 'g', { unit: 'g', weightPerPcKg: 0.012 })).toBe(24)
    // без веса штуки перевод невозможен — это сигнал «заполните вес», а не ноль
    expect(convertQty(2, 'pcs', 'g', { unit: 'g' })).toBeNull()
    expect(convertQty(24, 'g', 'pcs', { unit: 'pcs', weightPerPcKg: 0.012 })).toBe(2)
  })
})

describe('F2: выход и потери, двунаправленный ввод', () => {
  it('потери холодной и горячей: брутто → нетто → выход', () => {
    const y = resolveYield({ brutto: 1000, lossColdPct: 10, lossHotPct: 20 })
    expect(y.netto).toBe(900)
    expect(y.yieldQty).toBe(720)
  })

  it('ввели нетто — процент потерь считается сам (как в Quick Resto)', () => {
    const y = resolveYield({ brutto: 1.2, netto: 0.8, lossHotPct: 0 })
    expect(y.lossColdPct).toBeCloseTo(33.33, 2)
    expect(y.yieldQty).toBeCloseTo(0.8, 3)
    expect(y.computed).toContain('lossColdPct')
  })

  it('ввели выход — процент горячей обработки считается сам', () => {
    const y = resolveYield({ brutto: 1, lossColdPct: 0, yieldQty: 0.7 })
    expect(y.lossHotPct).toBeCloseTo(30, 2)
  })

  it('отрицательные потери допустимы: варка прибавляет вес', () => {
    const y = resolveYield({ brutto: 100, lossColdPct: 0, lossHotPct: -150 })
    expect(y.yieldQty).toBeCloseTo(250, 3)
    expect(y.warnings).toHaveLength(0)
  })

  it('потери 100 % — предупреждение, а не тихий ноль', () => {
    const y = resolveYield({ brutto: 100, lossColdPct: 100 })
    expect(y.netto).toBe(0)
    expect(y.warnings.join(' ')).toMatch(/потери 100/)
    expect(y.warnings.join(' ')).toMatch(/нетто/)
  })

  it('нулевое брутто не ломает расчёт — возвращает предупреждение', () => {
    const y = resolveYield({ brutto: 0 })
    expect(y.brutto).toBe(0)
    expect(y.warnings).toHaveLength(1)
  })
})

describe('F2: цены', () => {
  const now = 1_000 * DAY

  it('средневзвешенная по накладным в окне', () => {
    const r = weightedCostKop(
      [
        { at: now - 10 * DAY, qty: 10, unitCostKop: 300 },
        { at: now - 5 * DAY, qty: 5, unitCostKop: 500 },
      ],
      { since: now - 90 * DAY },
    )
    expect(r.source).toBe('invoice')
    expect(r.costKop).toBeCloseTo((10 * 300 + 5 * 500) / 15, 5)
  })

  it('накладные старше окна не учитываются', () => {
    const r = weightedCostKop(
      [
        { at: now - 300 * DAY, qty: 100, unitCostKop: 100 },
        { at: now - 1 * DAY, qty: 1, unitCostKop: 900 },
      ],
      { since: now - 90 * DAY },
    )
    expect(r.costKop).toBe(900)
  })

  it('без приходов берётся последняя известная цена, затем ручная', () => {
    expect(
      weightedCostKop([], { since: now - 90 * DAY, history: [{ at: now - 200 * DAY, costKop: 120 }] }).source,
    ).toBe('history')
    expect(weightedCostKop([], { since: now - 90 * DAY, manualKop: 55 }).costKop).toBe(55)
    expect(weightedCostKop([], { since: now - 90 * DAY }).source).toBe('none')
  })

  it('окно начинается от последней инвентаризации, если она позже', () => {
    const inv = now - 10 * DAY
    expect(priceWindowStart(now, inv, 90)).toBe(inv)
    expect(priceWindowStart(now, now - 200 * DAY, 90)).toBe(now - 90 * DAY)
  })
})

describe('F2: строки и итоги карты', () => {
  it('строка считается по брутто, а не по выходу (как списывается склад)', () => {
    const r = resolveLine({ qtyBrutto: 1000, lossColdPct: 50, unitCostKop: 2 })
    expect(r.yield.yieldQty).toBe(500)
    expect(r.costKop).toBe(2000) // 1000 г × 2 коп.
  })

  it('несовпадение единиц переводится', () => {
    const r = resolveLine({
      qtyBrutto: 1,
      fromUnit: 'kg',
      toUnit: 'g',
      unitCostKop: 3,
      meta: { unit: 'g' },
    })
    expect(r.costKop).toBe(3000)
  })

  it('заготовка: количество × себестоимость её единицы из нормы закладки', () => {
    const r = resolveLine({ qtyBrutto: 150, child: { costKop: 4000, outputQty: 1000, outputUnit: 'ml' } })
    expect(r.costKop).toBe(600)
  })

  it('строка без цены делает карту «неполной», но не обнуляет посчитанное', () => {
    const t = cardTotals([
      { qtyBrutto: 10, unitCostKop: 100 },
      { qtyBrutto: 5, unitCostKop: null },
    ])
    expect(t.missing).toBe(true)
    expect(t.costKop).toBe(1000)
  })

  it('optional-строки не входят в базу, но показываются отдельно', () => {
    const t = cardTotals([
      { qtyBrutto: 10, unitCostKop: 100 },
      { qtyBrutto: 5, unitCostKop: 100, lineRole: 'optional' },
    ])
    expect(t.costKop).toBe(1000)
    expect(t.optionalKop).toBe(500)
  })

  it('норма закладки делит стоимость на порции', () => {
    expect(costPerUnitKop(5000, 10)).toBe(500)
    expect(costPerUnitKop(5000, 0)).toBeNull()
  })

  it('фудкост, маржа и цена по наценке', () => {
    expect(foodCostPct(50, 200)).toBe(25)
    expect(marginKop(50, 200)).toBe(150)
    expect(retailFromMarkup(50, 300)).toBe(200)
    expect(foodCostPct(null, 200)).toBeNull()
  })
})

describe('F2: циклы, проекция, сигналы', () => {
  it('прямой цикл заготовок находится', () => {
    expect(findCycle({ 1: [2], 2: [1] })).toEqual([1, 2, 1])
  })

  it('длинный цикл и нормальный граф', () => {
    expect(findCycle({ 1: [2], 2: [3], 3: [1] })).toEqual([1, 2, 3, 1])
    expect(findCycle({ 1: [2], 2: [3], 3: [] })).toBeNull()
  })

  it('проекция норм склада агрегирует одинаковые позиции и переводит единицы', () => {
    const norms = projectNorms([
      { stockItemId: 7, qty: 18, unit: 'g', targetUnit: 'g' },
      { stockItemId: 7, qty: 0.002, unit: 'kg', targetUnit: 'g' },
      { stockItemId: 9, qty: 1, unit: 'pcs', targetUnit: 'g' },
    ])
    expect(norms).toEqual([{ stockItemId: 7, qty: 20 }])
  })

  it('бейджи: нет цены, нет розницы, высокий фудкост, отрицательная маржа', () => {
    expect(cardInsights({ costKop: null, retailKop: null, missingPrices: true, foodCostPct: null }).map((i) => i.code)).toEqual([
      'no_cost',
      'no_price',
      'no_retail',
    ])
    expect(cardInsights({ costKop: 50, retailKop: 40, missingPrices: false, foodCostPct: 125 }).map((i) => i.code)).toEqual([
      'high_food_cost',
      'negative_margin',
    ])
    expect(cardInsights({ costKop: 50, retailKop: 200, missingPrices: false, foodCostPct: 25 })).toEqual([])
  })
})

describe('F11: постоянные расходы на порцию', () => {
  it('режим «на единицу»: сумма месяца делится на проданные единицы', () => {
    const r = overheadPerUnit({ totalKop: 300_000, mode: 'units', soldUnits: 3000, revenueKop: 0 })
    expect(r.perUnitKop).toBe(100) // 3000 ₽ / 3000 чашек = 1 ₽
    expect(r.basis).toBe('sales')
  })

  it('без продаж берётся плановый объём и это честно помечено', () => {
    const r = overheadPerUnit({ totalKop: 300_000, mode: 'units', soldUnits: 0, revenueKop: 0, plannedUnits: 1500 })
    expect(r.perUnitKop).toBe(200)
    expect(r.basis).toBe('planned')
  })

  it('без продаж и плана — null, а не выдуманное число', () => {
    const r = overheadPerUnit({ totalKop: 300_000, mode: 'units', soldUnits: 0, revenueKop: 0 })
    expect(r.perUnitKop).toBeNull()
    expect(r.basis).toBe('none')
  })

  it('режим «по выручке»: дорогая позиция забирает больше расходов', () => {
    const cheap = overheadPerUnit({
      totalKop: 100_000,
      mode: 'revenue',
      soldUnits: 100,
      revenueKop: 100_000, // 1000 ₽ выручки
      priceKop: 20_000, // 200 ₽
    })
    const pricey = overheadPerUnit({
      totalKop: 100_000,
      mode: 'revenue',
      soldUnits: 100,
      revenueKop: 100_000,
      priceKop: 40_000, // 400 ₽
    })
    expect(cheap.perUnitKop).toBeCloseTo(20_000, 0) // 1000 ₽ × 200/1000
    expect(pricey.perUnitKop).toBeCloseTo(40_000, 0)
    expect(pricey.shareOfPricePct).toBeCloseTo(100, 1)
  })

  it('ноль в расходах — распределять нечего', () => {
    const r = overheadPerUnit({ totalKop: 0, mode: 'units', soldUnits: 100, revenueKop: 0 })
    expect(r.perUnitKop).toBeNull()
  })
})

describe('меню-инжиниринг: продажи × маржа', () => {
  const item = (cardId: number, name: string, qtySold: number, revenueKop: number, costPerUnitKop: number | null) => ({
    cardId,
    name,
    qtySold,
    revenueKop,
    costPerUnitKop,
    priceKop: null,
  })

  it('раскладывает четыре классические категории', () => {
    // 400 порций → средний объём 100, порог популярности 70; средняя маржа 5 562,5 коп.
    const r = menuEngineering([
      item(1, 'Звезда', 200, 2_000_000, 2_000), // 200 шт по 100 ₽, маржа 80 ₽
      item(2, 'Лошадка', 150, 1_500_000, 9_500), // 150 шт по 100 ₽, маржа 5 ₽
      item(3, 'Загадка', 30, 600_000, 2_000), // 30 шт по 200 ₽, маржа 180 ₽
      item(4, 'Собака', 20, 200_000, 9_500), // 20 шт по 100 ₽, маржа 5 ₽
    ])
    const byName = new Map(r.rows.map((x) => [x.name, x]))
    expect(byName.get('Звезда')!.category).toBe('star')
    expect(byName.get('Лошадка')!.category).toBe('plowhorse')
    expect(byName.get('Загадка')!.category).toBe('puzzle')
    expect(byName.get('Собака')!.category).toBe('dog')
    // Порог популярности посчитан от среднего объёма и коэффициента 0.7.
    expect(r.thresholds.popularityFactor).toBe(0.7)
    expect(r.thresholds.popularityQty).toBeCloseTo(70, 2)
  })

  it('«лошадка» — это много продаж при марже ниже средней', () => {
    // Все цены ниже — в копейках: 300 шт по 100 ₽ = 3 000 000 коп.
    const r = menuEngineering([
      item(1, 'Кофе', 300, 3_000_000, 2_000), // маржа 80 ₽
      item(2, 'Чай', 300, 3_000_000, 9_000), // маржа 10 ₽ — ниже средней
      item(3, 'Десерт', 20, 400_000, 1_000), // маржа 190 ₽, но продаётся редко
    ])
    const chat = r.rows.find((x) => x.name === 'Чай')!
    expect(chat.category).toBe('plowhorse')
    expect(chat.marginPerUnitKop).toBeCloseTo(1_000, 0) // 10 ₽ на порцию
    expect(r.rows.find((x) => x.name === 'Десерт')!.category).toBe('puzzle')
  })

  it('ABC по выручке: 80/95 % → A, B, C', () => {
    const r = menuEngineering([
      item(1, 'Большой', 10, 80_000, 1_000),
      item(2, 'Средний', 10, 15_000, 1_000),
      item(3, 'Малый', 10, 5_000, 1_000),
    ])
    const abc = new Map(r.rows.map((x) => [x.name, x.abcRevenue]))
    expect(abc.get('Большой')).toBe('A')
    expect(abc.get('Средний')).toBe('B')
    expect(abc.get('Малый')).toBe('C')
  })

  it('одна позиция всегда A, а не C', () => {
    const r = menuEngineering([item(1, 'Единственная', 5, 5_000, 500)])
    expect(r.rows[0]!.abcRevenue).toBe('A')
    expect(r.rows[0]!.abcProfit).toBe('A')
    expect(r.rows[0]!.shareRevenuePct).toBeCloseTo(100, 1)
  })

  it('позиции без продаж и без себестоимости не тянут пороги, но видны с причиной', () => {
    const r = menuEngineering([
      item(1, 'Продаётся', 100, 10_000, 1_000),
      item(2, 'Нет продаж', 0, 0, 1_000),
      item(3, 'Нет цены сырья', 50, 5_000, null),
    ])
    expect(r.totals.counted).toBe(1)
    expect(r.totals.cards).toBe(3)
    expect(r.totals.noSales).toBe(1)
    expect(r.totals.noCost).toBe(1)
    expect(r.totals.revenueKop).toBe(10_000)

    const noSales = r.rows.find((x) => x.name === 'Нет продаж')!
    expect(noSales.category).toBe('none')
    expect(noSales.reason).toMatch(/нет продаж/)
    expect(noSales.profitKop).toBeNull()

    const noCost = r.rows.find((x) => x.name === 'Нет цены сырья')!
    expect(noCost.category).toBe('none')
    expect(noCost.reason).toMatch(/себестоимость/)
    expect(noCost.abcRevenue).toBeNull()
  })

  it('непроданные карты стоят в конце списка', () => {
    const r = menuEngineering([item(1, 'Тишина', 0, 0, 1_000), item(2, 'Работает', 10, 1_000, 100)])
    expect(r.rows[0]!.name).toBe('Работает')
    expect(r.rows[1]!.name).toBe('Тишина')
  })

  it('суммы, маржинальность и доли считаются по проданному объёму', () => {
    const r = menuEngineering([item(1, 'A', 10, 10_000, 500), item(2, 'B', 30, 15_000, 400)])
    expect(r.totals.qtySold).toBe(40)
    expect(r.totals.revenueKop).toBe(25_000)
    expect(r.totals.costKop).toBe(17_000) // 10×500 + 30×400
    expect(r.totals.profitKop).toBe(8_000)
    expect(r.totals.marginPct).toBeCloseTo(32, 0) // 8000/25000
    expect(r.rows.find((x) => x.name === 'A')!.shareProfitPct).toBeCloseTo(62.5, 1)
  })

  it('отрицательная маржа — «собака» с советом убрать', () => {
    // Убыточная: 100 шт по 100 ₽, себестоимость 200 ₽. Норма: 100 шт по 100 ₽, 10 ₽.
    const r = menuEngineering([item(1, 'Убыточная', 100, 1_000_000, 20_000), item(2, 'Норма', 100, 1_000_000, 1_000)])
    const loss = r.rows.find((x) => x.name === 'Убыточная')!
    expect(loss.category).toBe('dog')
    expect(loss.profitKop).toBeLessThan(0)
    expect(loss.marginPct).toBeLessThan(0)
    expect(loss.advice).toMatch(/убрать|заменить/)
  })

  it('пустое меню не падает', () => {
    const r = menuEngineering([])
    expect(r.rows).toHaveLength(0)
    expect(r.totals.counted).toBe(0)
    expect(r.thresholds.popularityQty).toBeNull()
    expect(r.thresholds.marginPerUnitKop).toBeNull()
  })
})

describe('распределение постоянных расходов по структуре продаж', () => {
  const articles = [
    { kind: 'rent' as const, amountKop: 150_000_00 },
    { kind: 'salary' as const, amountKop: 90_000_00 },
    { kind: 'tax' as const, amountKop: 10_000_00 },
  ]

  it('по количеству: у всех позиций одинаковая надбавка на единицу', () => {
    const r = allocateOverheads({
      articles,
      mode: 'units',
      mix: [
        { cardId: 1, units: 70, revenueKop: 70 * 30_000 },
        { cardId: 2, units: 20, revenueKop: 20 * 15_000 },
        { cardId: 3, units: 10, revenueKop: 10 * 35_000 },
      ],
    })
    expect(r.basis).toBe('units')
    expect(r.totalKop).toBe(250_000_00)
    // 250 000 ₽ / 100 шт = 2 500 ₽ на любую порцию — это и есть «поровну на единицу».
    for (const row of r.rows) expect(row.perUnitKop).toBeCloseTo(2_500_00, 0)
    expect(r.rows.reduce((s2, x) => s2 + x.sharePct, 0)).toBeCloseTo(100, 1)
  })

  it('по выручке: дорогая позиция забирает больше расходов, дешёвая — меньше', () => {
    const r = allocateOverheads({
      articles,
      mode: 'revenue',
      mix: [
        { cardId: 1, units: 70, revenueKop: 70 * 30_000 }, // капучино 300 ₽
        { cardId: 2, units: 20, revenueKop: 20 * 15_000 }, // эспрессо 150 ₽
        { cardId: 3, units: 10, revenueKop: 10 * 35_000 }, // латте 350 ₽
      ],
    })
    expect(r.basis).toBe('revenue')
    const byId = new Map(r.rows.map((x) => [x.cardId, x]))
    const cap = byId.get(1)!
    const esp = byId.get(2)!
    const lat = byId.get(3)!
    // Доли = плановая выручка: 21 000 / 3 000 / 3 500 из 27 500.
    expect(cap.sharePct).toBeCloseTo(76.4, 1)
    expect(esp.sharePct).toBeCloseTo(10.9, 1)
    expect(lat.sharePct).toBeCloseTo(12.7, 1)
    expect(cap.perUnitKop).toBeGreaterThan(esp.perUnitKop)
    expect(lat.perUnitKop).toBeGreaterThan(cap.perUnitKop) // латте дороже капучино
    // Сумма расходов по позициям равна общей сумме.
    expect(r.rows.reduce((s2, x) => s2 + x.overheadKop, 0)).toBeCloseTo(250_000_00, 0)
  })

  it('разбивка по статьям складывается в надбавку позиции', () => {
    const r = allocateOverheads({
      articles,
      mode: 'revenue',
      mix: [{ cardId: 1, units: 100, revenueKop: 100 * 20_000 }],
    })
    const row = r.rows[0]!
    const sum = row.breakdown.reduce((s2, b) => s2 + b.perUnitKop, 0)
    expect(row.breakdown.map((b) => b.kind).sort()).toEqual(['rent', 'salary', 'tax'])
    expect(sum).toBeCloseTo(row.perUnitKop, 0)
    expect(row.breakdown.find((b) => b.kind === 'rent')!.perUnitKop).toBeCloseTo(1_500_00, 0)
  })

  it('позиции без плана не участвуют в делении', () => {
    const r = allocateOverheads({
      articles,
      mode: 'units',
      mix: [
        { cardId: 1, units: 50, revenueKop: 0 },
        { cardId: 2, units: 0, revenueKop: 0 },
      ],
    })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]!.cardId).toBe(1)
    expect(r.rows[0]!.sharePct).toBeCloseTo(100, 1)
  })

  it('нет базы или нет расходов — нули, а не выдуманные числа', () => {
    const empty = allocateOverheads({ articles, mode: 'units', mix: [] })
    expect(empty.basis).toBe('none')
    expect(empty.rows).toHaveLength(0)

    const noMoney = allocateOverheads({
      articles: [],
      mode: 'units',
      mix: [{ cardId: 1, units: 10, revenueKop: 1000 }],
    })
    expect(noMoney.rows[0]!.perUnitKop).toBe(0)
  })

  it('режим «по выручке» без выручки честно падает на количество', () => {
    const r = allocateOverheads({
      articles,
      mode: 'revenue',
      mix: [{ cardId: 1, units: 10, revenueKop: 0 }, { cardId: 2, units: 30, revenueKop: 0 }],
    })
    expect(r.basis).toBe('units')
    expect(r.rows[0]!.perUnitKop).toBeCloseTo(250_000_00 / 40, 0)
  })
})

describe('веса популярности → штуки плана', () => {
  it('делит общий план пропорционально весам', () => {
    const u = unitsFromWeights(new Map([[1, 7], [2, 2], [3, 1]]), 100, [1, 2, 3])
    expect(u.get(1)).toBeCloseTo(70, 3)
    expect(u.get(2)).toBeCloseTo(20, 3)
    expect(u.get(3)).toBeCloseTo(10, 3)
  })

  it('вес 0 — позиция не участвует, остальные делят весь план', () => {
    const u = unitsFromWeights(new Map([[1, 5], [2, 0]]), 50, [1, 2])
    expect(u.get(1)).toBeCloseTo(50, 3)
    expect(u.get(2)).toBe(0)
  })

  it('все веса нулевые — делим поровну, а не теряем план', () => {
    const u = unitsFromWeights(new Map(), 90, [1, 2, 3])
    expect(u.get(1)).toBeCloseTo(30, 3)
    expect(u.get(2)).toBeCloseTo(30, 3)
  })

  it('общий план не задан — штук нет', () => {
    const u = unitsFromWeights(new Map([[1, 3]]), 0, [1])
    expect(u.get(1)).toBe(0)
  })
})
