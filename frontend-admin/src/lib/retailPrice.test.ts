import { describe, expect, it } from 'vitest'

import { foodCostPercent, marginRub, priceFromMarkup, resolveRetailPrice } from './retailPrice'

const base = {
  catalogPriceRub: 200,
  manualPriceRub: null as number | null,
  markupPct: 300,
  costPerUnitRub: 50,
}

describe('retailPrice', () => {
  it('берёт цену меню в режиме каталога, как было до правки', () => {
    expect(resolveRetailPrice({ ...base, mode: 'catalog' })).toBe(200)
  })

  it('своя цена карты важнее цены меню и сразу меняет маржу', () => {
    const price = resolveRetailPrice({ ...base, mode: 'manual', manualPriceRub: 320 })
    expect(price).toBe(320)
    expect(marginRub(base.costPerUnitRub, price)).toBe(270)
    expect(foodCostPercent(base.costPerUnitRub, price)).toBe(15.6)
  })

  it('наценка считается от себестоимости и подставляется в цену', () => {
    expect(priceFromMarkup(50, 300)).toBe(200)
    expect(resolveRetailPrice({ ...base, mode: 'markup', markupPct: 450 })).toBe(275)
  })

  it('без цены меню каталог падает на свою цену, затем на наценку', () => {
    expect(resolveRetailPrice({ ...base, mode: 'catalog', catalogPriceRub: null, manualPriceRub: 260 })).toBe(260)
    expect(resolveRetailPrice({ ...base, mode: 'catalog', catalogPriceRub: 0, manualPriceRub: null })).toBe(200)
  })

  it('без себестоимости маржа и фудкост не считаются', () => {
    expect(resolveRetailPrice({ ...base, mode: 'markup', costPerUnitRub: null, manualPriceRub: 150 })).toBe(150)
    expect(marginRub(null, 150)).toBeNull()
    expect(foodCostPercent(null, 150)).toBeNull()
  })
})
