/**
 * F12: подписи и фильтры меню-инжиниринга. Чистые функции — их проверяют тесты,
 * экран только рисует.
 */
import type { AbcClass, MenuCategory, MenuEngineeringRow } from './costApi'

export type MenuFilter = MenuCategory | 'all'

export const MENU_CATEGORY_LABELS: Record<MenuCategory, string> = {
  star: 'Звезда',
  plowhorse: 'Лошадка',
  puzzle: 'Загадка',
  dog: 'Собака',
  none: 'Без продаж',
}

export const MENU_CATEGORY_TONES: Record<MenuCategory, 'ok' | 'warn' | 'bad' | 'neutral' | 'brand'> = {
  star: 'ok',
  plowhorse: 'brand',
  puzzle: 'warn',
  dog: 'bad',
  none: 'neutral',
}

/** Краткое пояснение категории — чтобы владелец не гуглил, что такое «загадка». */
export const MENU_CATEGORY_HINTS: Record<MenuCategory, string> = {
  star: 'часто берут и хорошо зарабатывает',
  plowhorse: 'часто берут, но маржа низкая',
  puzzle: 'маржа хорошая, но берут редко',
  dog: 'редко берут и мало зарабатывает',
  none: 'нет продаж или не посчитана себестоимость',
}

export const ABC_TONES: Record<AbcClass, 'ok' | 'warn' | 'neutral'> = { A: 'ok', B: 'warn', C: 'neutral' }

export function filterMenuRows(rows: MenuEngineeringRow[], filter: MenuFilter): MenuEngineeringRow[] {
  return filter === 'all' ? rows : rows.filter((r) => r.category === filter)
}

/** Сколько позиций в каждой категории — для подписей на фильтрах. */
export function countByCategory(rows: MenuEngineeringRow[]): Record<MenuFilter, number> {
  const out: Record<MenuFilter, number> = { all: rows.length, star: 0, plowhorse: 0, puzzle: 0, dog: 0, none: 0 }
  for (const r of rows) out[r.category] += 1
  return out
}

/** Выгрузка для бухгалтера/владельца: те же колонки, что на экране. */
export function menuCsvHead(): string[] {
  return [
    'Позиция',
    'Категория',
    'ABC по выручке',
    'ABC по прибыли',
    'Продано, шт',
    'Выручка, ₽',
    'Средняя цена, ₽',
    'Себестоимость, ₽',
    'Маржа на порцию, ₽',
    'Маржинальность, %',
    'Доля выручки, %',
    'Доля прибыли, %',
    'Совет',
  ]
}

/** Русский Excel: разделитель `;`, десятичная запятая. */
const num = (v: number | null, digits = 2): string => (v == null ? '—' : v.toFixed(digits).replace('.', ','))

export function menuCsvRows(rows: MenuEngineeringRow[]): string[][] {
  return rows.map((r) => [
    r.name,
    MENU_CATEGORY_LABELS[r.category],
    r.abcRevenue ?? '—',
    r.abcProfit ?? '—',
    String(r.qtySold),
    num(r.revenueRub),
    num(r.avgPriceRub),
    num(r.costPerUnitRub),
    num(r.marginPerUnitRub),
    num(r.marginPct, 1),
    num(r.shareRevenuePct, 1),
    num(r.shareProfitPct, 1),
    r.advice,
  ])
}
