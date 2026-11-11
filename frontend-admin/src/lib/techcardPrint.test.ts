import { describe, expect, it } from 'vitest'

import type { CardLine, TechCard } from './costApi'
import { ingredientRow, lineUnit, techCardPrint } from './techcardPrint'

const line = (over: Partial<CardLine> = {}): CardLine => ({
  id: 1,
  stockItemId: 10,
  stockItemName: 'Кофе зерно',
  itemUnit: 'g',
  childCardId: null,
  childCardName: null,
  childOutputUnit: null,
  qtyBrutto: 18,
  lossColdPct: 0,
  lossHotPct: 0,
  qtyNetto: 18,
  qtyYield: 18,
  computed: [],
  warnings: [],
  lineRole: 'base',
  unitCostRub: 2,
  costSource: 'manual',
  lineCostRub: 36,
  ...over,
})

const card = (over: Partial<TechCard> = {}): TechCard => ({
  id: 7,
  name: 'Капучино 250 мл',
  kind: 'dish',
  outputQty: 1,
  outputUnit: 'pcs',
  productId: null,
  status: 'active',
  writeOffMode: 'ingredients',
  retailPriceRub: 250,
  markupPct: 300,
  methodText: '1. Смолоть зерно.\n2. Взбить молоко.',
  version: { id: 3, validFrom: new Date('2026-11-01T00:00:00Z').getTime(), note: 'зима' },
  versions: [],
  costRub: 55,
  costPerUnitRub: 55,
  optionalRub: null,
  retailRub: 250,
  retailCalcRub: 220,
  foodCostPct: 22,
  marginRub: 195,
  overheadEnabled: false,
  overheadPerUnitRub: null,
  fullCostPerUnitRub: 55,
  fullFoodCostPct: 22,
  fullMarginRub: 195,
  overheadSharePct: null,
  overheadBreakdownRub: [],
  missingPrices: false,
  insights: [],
  lines: [line()],
  ...over,
})

describe('печатная ТТК: модель карточки', () => {
  it('строка рецептуры: брутто/нетто/выход, цена и сумма с русской запятой', () => {
    const r = ingredientRow(line({ qtyBrutto: 18.5, qtyNetto: 18, qtyYield: 17.25, lineCostRub: 36.5 }), 0, 'pcs')
    expect(r.n).toBe(1)
    expect(r.name).toBe('Кофе зерно')
    expect(r.brutto).toBe('18,5')
    expect(r.netto).toBe('18')
    expect(r.out).toBe('17,25')
    expect(r.unit).toBe('г')
    expect(r.sumRub).toBe('36,50')
    expect(r.isSemi).toBe(false)
  })

  it('потери печатаются только когда они заданы', () => {
    expect(ingredientRow(line(), 0, 'pcs').losses).toBeNull()
    const r = ingredientRow(line({ lossColdPct: 5, lossHotPct: 12.5 }), 0, 'pcs')
    expect(r.losses).toBe('потери хол. 5 %, гор. 12,5 %')
  })

  it('у заготовки в графе «ед.» стоит единица выхода заготовки', () => {
    const semi = line({ stockItemId: null, stockItemName: null, itemUnit: null, childCardId: 4, childCardName: 'Молоко взбитое', childOutputUnit: 'ml', unitCostRub: 0.1, lineCostRub: 15 })
    expect(lineUnit(semi, 'pcs')).toBe('мл')
    const r = ingredientRow(semi, 0, 'pcs')
    expect(r.name).toBe('Молоко взбитое')
    expect(r.isSemi).toBe(true)
  })

  it('итоги: выход, себестоимость, цена, фудкост и маржа', () => {
    const p = techCardPrint(card())
    const byLabel = new Map(p.totals.map((t) => [t.label, t.value]))
    expect(byLabel.get('Выход изделия')).toBe('1 шт')
    expect(byLabel.get('Себестоимость порции')).toBe('55,00 ₽')
    expect(byLabel.get('Цена продажи')).toBe('250,00 ₽')
    expect(byLabel.get('Фудкост')).toBe('22,00 %')
    expect(byLabel.get('Маржа')).toBe('195,00 ₽')
    // Флаг постоянных расходов выключен — строк про них нет.
    expect(byLabel.has('Полная себестоимость')).toBe(false)
  })

  it('с включёнными расходами печатается полная себестоимость', () => {
    const p = techCardPrint(
      card({ overheadEnabled: true, overheadPerUnitRub: 45, fullCostPerUnitRub: 100, fullFoodCostPct: 40 }),
    )
    const byLabel = new Map(p.totals.map((t) => [t.label, t.value]))
    expect(byLabel.get('Постоянные расходы на порцию')).toBe('45,00 ₽')
    expect(byLabel.get('Полная себестоимость')).toBe('100,00 ₽')
    expect(byLabel.get('Фудкост с расходами')).toBe('40,00 %')
  })

  it('флаг включён, а расходов нет — лишних строк про них не печатаем', () => {
    const p = techCardPrint(card({ overheadEnabled: true, overheadPerUnitRub: null, fullFoodCostPct: 22 }))
    const labels = p.totals.map((t) => t.label)
    expect(labels).not.toContain('Постоянные расходы на порцию')
    expect(labels).not.toContain('Фудкост с расходами')
    expect(labels).not.toContain('Полная себестоимость')
  })

  it('пустая карточка предупреждает, но печатается', () => {
    const p = techCardPrint(
      card({ lines: [], costRub: null, costPerUnitRub: null, foodCostPct: null, marginRub: null, retailRub: null, missingPrices: true, methodText: null }),
    )
    expect(p.rows).toHaveLength(0)
    expect(p.technology).toBe('—')
    expect(p.warnings.join(' ')).toMatch(/Состав не заполнен/)
    expect(p.warnings.join(' ')).toMatch(/нет цены/)
    expect(p.warnings.join(' ')).toMatch(/цена продажи/)
  })

  it('версия карты попадает в шапку с датой', () => {
    const p = techCardPrint(card())
    expect(p.versionText).toMatch(/действует с \d{2}\.\d{2}\.\d{4}/)
    expect(p.versionText).toMatch(/зима/)
    expect(techCardPrint(card({ version: null })).versionText).toBe('черновик без версии')
  })
})
