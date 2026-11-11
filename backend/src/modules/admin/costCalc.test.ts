import { describe, expect, it } from 'vitest'

import {
  cardInsights,
  cardTotals,
  convertQty,
  costPerUnitKop,
  findCycle,
  foodCostPct,
  marginKop,
  priceWindowStart,
  projectNorms,
  resolveLine,
  resolveYield,
  retailFromMarkup,
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
