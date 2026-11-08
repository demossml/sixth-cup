/**
 * Серверный расчёт позиции заказа: цена и название добавок берутся из каталога, а не от клиента.
 *
 * Клиент присылает только выбор — `modifierId` (id опции схемы, как в `/api/directory/config`)
 * и `groupKey`. Всё остальное (цена, название, привязка товара для UUID) резолвится здесь.
 *
 * Один резолвер для quote и для создания заказа: иначе корзина обещает одну сумму,
 * а заказ получает другую (это и был дефект B-07 из аудита).
 */
import type Database from 'better-sqlite3'
import { buildCatalogToppings, type CatalogTopping } from '../catalog/addonScheme'
import { getMilkScheme } from '../catalog/milkScheme'

/** enough of better-sqlite3 for the price lookups; тестовые обёртки не обязаны быть полным Database. */
type Db = Database.Database

export type ModifierInLike = {
  groupKey?: string | null
  modifierId: string | number
  /** Игнорируются: цена и имя всегда серверные. Оставлены в типе для совместимости входа. */
  name?: string | null
  priceRub?: number | null
  productId?: number | null
}

export type ResolvedModifier = {
  groupKey: string
  /** id опции (то, что прислал клиент) — по нему касса и админка сверяют состав. */
  optionId: string
  name: string
  priceRub: number
  /** Товар, который знает касса: нужен для `evotorUuid`. */
  productId: number | null
  zeroOption: boolean
}

export type ResolvedItem = {
  modifiers: ResolvedModifier[]
  /** Цена одной единицы позиции: SKU + платные добавки (молоко, сиропы, топпинги). */
  unitPrice: number
  warnings: string[]
}

export class ModifierError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Схема добавок, действующая для SKU: своя схема важнее схемы группы (как в витрине).
 * Таблицы `product_groups` может не быть в старых базах — тогда читаем только схему товара.
 */
function addonSchemeForProduct(db: Db, productId: number): number | null {
  try {
    const row = db
      .prepare(
        `SELECT p.modifier_scheme_id AS skuScheme, pg.modifier_scheme_id AS groupScheme
           FROM products p LEFT JOIN product_groups pg ON pg.id = p.group_id
          WHERE p.id=?`,
      )
      .get(productId) as { skuScheme: number | null; groupScheme: number | null } | undefined
    return row ? row.skuScheme ?? row.groupScheme ?? null : null
  } catch {
    try {
      const row = db.prepare('SELECT modifier_scheme_id AS id FROM products WHERE id=?').get(productId) as
        | { id: number | null }
        | undefined
      return row?.id ?? null
    } catch {
      // Совсем старая схема БД без схем добавок: добавок нет, заказ принимаем как есть.
      return null
    }
  }
}

function milkSchemeForProduct(db: Db, productId: number): number | null {
  try {
    const row = db.prepare('SELECT milk_scheme_id AS id FROM products WHERE id=?').get(productId) as
      | { id: number | null }
      | undefined
    return row?.id ?? null
  } catch {
    // Старая схема БД без схем молока — молока в заказе просто нет.
    return null
  }
}

/** Все допустимые опции позиции: добавки, молоко (с ценами) — по id опции. */
function allowedOptions(db: Db, productId: number): {
  addons: Map<number, CatalogTopping>
  milk: Map<number, { label: string; priceRub: number; productId: number | null }>
} {
  const addons = new Map<number, CatalogTopping>()
  const schemeId = addonSchemeForProduct(db, productId)
  if (schemeId != null) {
    for (const t of buildCatalogToppings(db as Database.Database, schemeId, new Map())) addons.set(Number(t.id), t)
  }

  const milk = new Map<number, { label: string; priceRub: number; productId: number | null }>()
  const milkSchemeId = milkSchemeForProduct(db, productId)
  const scheme = milkSchemeId != null ? getMilkScheme(milkSchemeId, db as Database.Database) : null
  if (scheme && !scheme.active) return { addons, milk }
  for (const v of scheme?.variants ?? []) {
    if (!v.active) continue
    const price = v.isFree ? 0 : productPrice(db, v.productId)
    milk.set(Number(v.id), { label: String(v.label), priceRub: price, productId: v.productId })
  }
  return { addons, milk }
}

function productPrice(db: Db, productId: number | null): number {
  if (productId == null) return 0
  const row = db.prepare('SELECT price FROM products WHERE id=?').get(productId) as { price: number } | undefined
  return Number(row?.price) || 0
}

/**
 * Резолв добавок позиции.
 * Неизвестная опция (чужая схема, опечатка, подделка) → `ModifierError('modifier_not_allowed')`.
 * Превышение `max_count` → `ModifierError('modifier_limit')`.
 */
export function resolveItemModifiers(
  db: Db,
  skuProductId: number,
  basePrice: number,
  modifiers: ModifierInLike[] = [],
): ResolvedItem {
  const { addons, milk } = allowedOptions(db, skuProductId)
  const out: ResolvedModifier[] = []
  const warnings: string[] = []
  const counts = new Map<string, number>()
  let unitPrice = Number(basePrice) || 0

  for (const m of modifiers) {
    const id = String(m.modifierId ?? '')
    if (!id) throw new ModifierError('modifier_not_allowed', 'Пустой id добавки')
    const group = String(m.groupKey ?? '')

    if (group === 'milk') {
      const v = milk.get(Number(id))
      if (!v) throw new ModifierError('modifier_not_allowed', `Молоко недоступно для этой позиции: ${id}`)
      unitPrice += v.priceRub
      out.push({
        groupKey: 'milk',
        optionId: id,
        name: v.label,
        priceRub: v.priceRub,
        productId: v.productId,
        zeroOption: v.priceRub === 0,
      })
      continue
    }

    const t = addons.get(Number(id))
    if (!t) throw new ModifierError('modifier_not_allowed', `Добавка недоступна для этой позиции: ${id}`)
    const seen = (counts.get(id) ?? 0) + 1
    if (seen > Math.max(1, Number(t.maxCount) || 1)) {
      throw new ModifierError('modifier_limit', `«${t.name}» можно добавить не больше ${t.maxCount} раз`)
    }
    counts.set(id, seen)
    const price = t.zeroOption ? 0 : Number(t.priceRub) || 0
    unitPrice += price
    if (!t.zeroOption && price > 0 && t.productId == null) {
      warnings.push(`modifier_without_product:${t.name}`)
    }
    out.push({
      groupKey: String(t.groupKey || group || 'extra'),
      optionId: id,
      name: String(t.name),
      priceRub: price,
      productId: t.productId ?? null,
      zeroOption: !!t.zeroOption,
    })
  }

  return { modifiers: out, unitPrice, warnings }
}

/** id модификатора справочника по опции схемы — для обратной совместимости со старыми экранами. */
export function modifierIdForOption(db: Db, productId: number, optionId: string): number | null {
  const schemeId = addonSchemeForProduct(db, productId)
  if (schemeId == null) return null
  try {
    const row = db
      .prepare('SELECT modifier_id AS id FROM modifier_scheme_options WHERE scheme_id=? AND id=?')
      .get(schemeId, Number(optionId)) as { id: number | null } | undefined
    if (row?.id != null) return Number(row.id)
    const legacy = db
      .prepare('SELECT modifier_id AS id FROM modifier_scheme_items WHERE scheme_id=? AND id=?')
      .get(schemeId, Number(optionId)) as { id: number | null } | undefined
    return legacy?.id != null ? Number(legacy.id) : null
  } catch {
    return null
  }
}
