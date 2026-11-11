import { describe, expect, it } from 'vitest'

import type { MenuEngineeringRow } from './costApi'
import {
  MENU_CATEGORY_HINTS,
  MENU_CATEGORY_LABELS,
  countByCategory,
  filterMenuRows,
  menuCsvHead,
  menuCsvRows,
} from './menuEngineering'

const row = (over: Partial<MenuEngineeringRow>): MenuEngineeringRow => ({
  cardId: 1,
  name: 'Латте',
  kind: 'dish',
  qtySold: 10,
  revenueRub: 2000,
  avgPriceRub: 200,
  costPerUnitRub: 60,
  profitRub: 1400,
  marginPerUnitRub: 140,
  marginPct: 70,
  shareRevenuePct: 100,
  shareProfitPct: 100,
  abcRevenue: 'A',
  abcProfit: 'A',
  category: 'star',
  advice: 'Держим',
  reason: null,
  ...over,
})

describe('меню-инжиниринг: подписи и фильтры', () => {
  it('у каждой категории есть подпись и пояснение', () => {
    for (const key of ['star', 'plowhorse', 'puzzle', 'dog', 'none'] as const) {
      expect(MENU_CATEGORY_LABELS[key]).toBeTruthy()
      expect(MENU_CATEGORY_HINTS[key]).toBeTruthy()
    }
    expect(MENU_CATEGORY_LABELS.star).toBe('Звезда')
  })

  it('фильтр «все» не режет список, остальные — только свою категорию', () => {
    const rows = [row({ cardId: 1 }), row({ cardId: 2, category: 'dog' }), row({ cardId: 3, category: 'none' })]
    expect(filterMenuRows(rows, 'all')).toHaveLength(3)
    expect(filterMenuRows(rows, 'dog').map((r) => r.cardId)).toEqual([2])
    expect(filterMenuRows(rows, 'star').map((r) => r.cardId)).toEqual([1])
    expect(filterMenuRows(rows, 'puzzle')).toHaveLength(0)
  })

  it('считает позиции по категориям для подписей фильтров', () => {
    const rows = [row({ cardId: 1 }), row({ cardId: 2 }), row({ cardId: 3, category: 'dog' })]
    expect(countByCategory(rows)).toEqual({ all: 3, star: 2, plowhorse: 0, puzzle: 0, dog: 1, none: 0 })
  })

  it('CSV повторяет колонки экрана и подставляет прочерки вместо пустых чисел', () => {
    const head = menuCsvHead()
    const [line] = menuCsvRows([row({ marginPerUnitRub: null, abcProfit: null, reason: 'нет продаж' })])
    expect(line).toHaveLength(head.length)
    expect(line).toContain('Звезда')
    expect(line).toContain('—') // маржа и ABC по прибыли неизвестны
    expect(line).toContain('2000,00') // русская запятая, как в остальных выгрузках
  })

  it('в CSV попадают и непроданные позиции — с причиной в совете', () => {
    const [line] = menuCsvRows([
      row({ qtySold: 0, revenueRub: null, category: 'none', advice: 'нет продаж за период' }),
    ])
    expect(line).toContain('Без продаж')
    expect(line.at(-1)).toBe('нет продаж за период')
  })
})
