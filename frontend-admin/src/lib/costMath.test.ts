import { describe, expect, it } from 'vitest'

import { COST_SOURCE_LABELS, KIND_LABELS, lineCostRub, lineNumbers, money, pct } from './costMath'

describe('F5: живой расчёт строки техкарты', () => {
  it('брутто + проценты потерь → нетто и выход', () => {
    const n = lineNumbers({ brutto: 1000, lossColdPct: 10, lossHotPct: 20 })
    expect(n.netto).toBe(900)
    expect(n.yieldQty).toBe(720)
  })

  it('ввели нетто — процент холодных потерь считается сам', () => {
    const n = lineNumbers({ brutto: 1200, netto: 800 })
    expect(n.lossColdPct).toBeCloseTo(33.33, 2)
    expect(n.yieldQty).toBe(800)
  })

  it('ввели выход — процент горячих потерь считается сам', () => {
    const n = lineNumbers({ brutto: 1000, lossColdPct: 0, yieldQty: 700 })
    expect(n.lossHotPct).toBeCloseTo(30, 2)
  })

  it('отрицательные потери допустимы (варка прибавляет вес)', () => {
    const n = lineNumbers({ brutto: 100, lossHotPct: -150 })
    expect(n.yieldQty).toBeCloseTo(250, 3)
  })

  it('дробное брутто не накапливает ошибок округления', () => {
    const n = lineNumbers({ brutto: 0.018, lossColdPct: 0, lossHotPct: 0 })
    expect(n.netto).toBe(0.018)
    expect(n.yieldQty).toBe(0.018)
  })
})

describe('F5: деньги и подписи', () => {
  it('стоимость строки считается по брутто и цене', () => {
    expect(lineCostRub(18, 2)).toBe(36)
    expect(lineCostRub(150, 0.1)).toBeCloseTo(15, 3)
  })

  it('без цены строку не выдумываем', () => {
    expect(lineCostRub(18, null)).toBeNull()
    expect(lineCostRub(0, 2)).toBeNull()
  })

  it('формат денег и процентов по-русски', () => {
    expect(money(42.5)).toBe('42,50 ₽')
    expect(money(null)).toBe('—')
    expect(pct(22.44)).toBe('22,4 %')
    expect(pct(null)).toBe('—')
  })

  it('подписи источников цены и типов карт на месте', () => {
    expect(COST_SOURCE_LABELS.invoice).toMatch(/накладн/)
    expect(COST_SOURCE_LABELS.manual).toMatch(/ручная/)
    expect(KIND_LABELS.semi).toBe('Заготовка')
  })
})
