import { config } from '../../config'
import { db } from '../../db'

/** Нормализация имени: NFKC, регистр, ё→е, схлопывание пробелов. */
export const normalizeName = (value: unknown) =>
  String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()

/** Секции кассы. Всё неизвестное (topping/other/пусто) = extra. */
export function normalizeGroupKey(v: unknown): 'milk' | 'syrup' | 'sugar' | 'extra' {
  const k = normalizeName(v)
  if (k === 'milk' || k === 'молоко') return 'milk'
  if (k === 'syrup' || k === 'сироп') return 'syrup'
  if (k === 'sugar' || k === 'сахар') return 'sugar'
  return 'extra'
}

/**
 * id категорий «Добавки». ADDONS_CATEGORY_ID (env) важнее; иначе по имени.
 * ВАЖНО: SQLite lower() не понимает кириллицу, поэтому имя сравниваем в JS, а не через LIKE.
 */
export function addonCategoryIds(): number[] {
  if (config.addonsCategoryId != null) return [config.addonsCategoryId]
  try {
    const rows = db.prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]
    return rows.filter((r) => normalizeName(r.name).includes('добавк')).map((r) => r.id)
  } catch {
    return []
  }
}

export type OptionRow = {
  id: number
  schemeId: number
  kind: 'product' | 'zero' | 'modifier'
  productId: number | null
  modifierId: number | null
  name: string | null
  groupKey: string
  isDefault: number
  required: number
  maxCount: number
  sortOrder: number
}

export function loadOptionsByScheme(): Map<number, OptionRow[]> {
  const out = new Map<number, OptionRow[]>()
  try {
    const rows = db.prepare(`
      SELECT id, scheme_id AS schemeId, kind, product_id AS productId, modifier_id AS modifierId,
             name, group_key AS groupKey, is_default AS isDefault, required, max_count AS maxCount, sort_order AS sortOrder
      FROM modifier_scheme_options ORDER BY sort_order, id
    `).all() as OptionRow[]
    for (const r of rows) {
      const a = out.get(r.schemeId) ?? []
      a.push(r)
      out.set(r.schemeId, a)
    }
  } catch { /* таблицы нет — старый режим */ }
  return out
}
