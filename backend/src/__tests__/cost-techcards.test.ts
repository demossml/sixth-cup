import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import { runMigrations } from '../db/migrate'
import {
  unitPriceKop,
  lineSumKop,
  recipeCostFromLines,
  parseIngredientsFromText,
} from '../modules/admin/cost'

beforeEach(() => {
  // migrate on shared test db — schema_migrations handles once; tables from 056
  runMigrations(db)
})

describe('cost formulas', () => {
  it('unit price from pack', () => {
    // 90 ₽ = 9000 kop per 1000 ml → 9 kop/ml
    expect(unitPriceKop(9000, 1000)).toBe(9)
    expect(unitPriceKop(null, 1000)).toBeNull()
  })
  it('line sum', () => {
    expect(lineSumKop(150, 9000, 1000)).toBe(150 * 9)
  })
  it('base cost ignores optional', () => {
    const t = recipeCostFromLines([
      { qty: 10, lineRole: 'base', packPriceKop: 180000, packQty: 1000 }, // coffee 1800₽/kg
      { qty: 150, lineRole: 'base', packPriceKop: 9000, packQty: 1000 },
      { qty: 20, lineRole: 'optional', packPriceKop: 64000, packQty: 700 },
    ])
    expect(t.missing).toBe(false)
    expect(t.costKop).toBe(10 * 180 + 150 * 9)
    expect(t.optionalKop).toBeGreaterThan(0)
  })
  it('missing price flagged', () => {
    const t = recipeCostFromLines([
      { qty: 1, lineRole: 'base', packPriceKop: null, packQty: 50 },
    ])
    expect(t.missing).toBe(true)
  })
})

describe('parseIngredientsFromText', () => {
  it('parses milk liter and cups', () => {
    const items = parseIngredientsFromText(
      'Молоко 3,2% 1 л — 95 ₽\nСтаканы 200 мл, 50 шт — 310 ₽\nСироп ваниль 0,7 л 640 руб',
    )
    expect(items.length).toBeGreaterThanOrEqual(2)
    const milk = items.find((i) => /молок/i.test(i.name))
    expect(milk?.unit).toBe('ml')
    expect(milk?.packQty).toBe(1000)
    expect(milk?.packPriceRub).toBe(95)
  })
})

describe('cost tables', () => {
  it('seed categories exist after migrate', () => {
    const n = (
      db.prepare(`SELECT COUNT(*) AS n FROM cost_ingredient_categories`).get() as { n: number }
    ).n
    expect(n).toBeGreaterThanOrEqual(7)
  })
})

import { parseTechcardText, parseQtyUnit, parseWideMatrix } from '../modules/admin/techcardImport'

describe('techcard import', () => {
  it('parseQtyUnit', () => {
    expect(parseQtyUnit('10 гр')?.qty).toBe(10)
    expect(parseQtyUnit('10 гр')?.unit).toBe('g')
    expect(parseQtyUnit('0,7 л')?.unit).toBe('ml')
    expect(parseQtyUnit('0,7 л')?.qty).toBe(700)
  })
  it('wide matrix cappuccino-like', () => {
    const rows = [
      ['КАПУЧИНО 200', '', 'ЛАТТЕ 200', ''],
      ['кофе молотый', '10 гр', 'кофе молотый', '10 гр'],
      ['молоко', '150 мл', 'молоко', '150 мл'],
      ['стакан 200 мл', '1 шт', 'стакан 200 мл', '1 шт'],
    ]
    const r = parseWideMatrix(rows)
    expect(r.length).toBeGreaterThanOrEqual(1)
    expect(r[0].lines.some((l) => /кофе/i.test(l.ingredientName))).toBe(true)
  })
  it('freeform text', () => {
    const r = parseTechcardText('КАПУЧИНО 200\nкофе молотый — 10 г\nмолоко — 150 мл')
    expect(r.length).toBeGreaterThanOrEqual(1)
  })
})
