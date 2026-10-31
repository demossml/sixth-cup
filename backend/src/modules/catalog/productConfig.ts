/**
 * Конфигурация одной карточки для кассы: объёмы + молоко + добавки.
 *
 * Единственный источник правды для нового проксированного маршрута
 * `GET /api/devices/products/:productId/configuration`.
 * Каталог (`/catalog`) отдаёт те же блоки плоско — для старых сборок APK.
 *
 * Правила:
 *  • объёмы — реальные SKU группы (`product_groups`) с UUID своей точки;
 *  • молоко — только из `milk_schemes` (`products.milk_scheme_id`);
 *  • добавки — только из `modifier_schemes`, никогда не обязательны;
 *  • UUID берутся исключительно из `product_store_links` запрошенной точки.
 */
import type Database from 'better-sqlite3'
import { buildCatalogToppings, effectiveSchemeId, ensureAddonSchemeSchema } from './addonScheme'
import { ensureMilkSchemeSchema, milkForProduct } from './milkScheme'

export const PRODUCT_CONFIG_SCHEMA_VERSION = 1

export type ConfigVolume = {
  productId: number
  evotorUuid: string | null
  name: string
  label: string | null
  sizeValue: number | null
  sizeUnit: string | null
  priceRub: number
  available: boolean
}

export type ConfigMilkOption = {
  id: number
  productId: number | null
  label: string
  evotorUuid: string | null
  isDefault: boolean
  isFree: boolean
  sendToReceipt: boolean
  sortOrder: number
  available: boolean
  notReadyReason: 'no_evotor_uuid' | null
}

export type ConfigMilkBlock = {
  /** null — схема объёму не назначена (`options: []`). */
  schemeId: number | null
  options: ConfigMilkOption[]
  /** Схема назначена и активна, но вариантов нет — касса не должна обходить обязательный выбор. */
  error?: 'empty_scheme'
}

export type ConfigAddonOption = {
  id: number
  productId: number | null
  name: string
  groupKey: string
  evotorUuid: string | null
  priceRub: number
  required: boolean
  maxCount: number
  isDefault: boolean
  zeroOption: boolean
  available: boolean
  sendToReceipt: boolean
}

export type ConfigAddonsBlock = {
  /** null — схема объёму не назначена (`options: []`). */
  schemeId: number | null
  options: ConfigAddonOption[]
}

export type ProductConfiguration = {
  ok: true
  schemaVersion: number
  storeUuid: string
  productId: number
  generatedAt: number
  volumes: ConfigVolume[]
  milk: { required: boolean; byProductId: Record<string, ConfigMilkBlock | null> } | null
  additions: { required: false; byProductId: Record<string, ConfigAddonsBlock | null> } | null
  configErrors: { productId: number; code: 'milk_scheme_empty'; message: string }[]
}

type SkuRow = {
  id: number
  name: string
  price: number
  available: number
  groupId: number | null
  variantLabel: string | null
  variantSort: number | null
  sizeValue: number | null
  sizeUnit: string | null
  modifierSchemeId: number | null
  milkSchemeId: number | null
}

const SKU_COLUMNS = `
  p.id, p.name, p.price, p.available, p.group_id AS groupId,
  p.variant_label AS variantLabel, p.variant_sort AS variantSort,
  p.size_value AS sizeValue, p.size_unit AS sizeUnit,
  p.modifier_scheme_id AS modifierSchemeId, p.milk_scheme_id AS milkSchemeId
`

/** UUID только этой точки, только включённые связи. */
function uuidMapForStore(db: Database.Database, storeUuid: string) {
  const map = new Map<number, string>()
  const rows = db
    .prepare(
      `SELECT product_id AS productId, evotor_uuid AS evotorUuid FROM product_store_links
       WHERE store_uuid=? AND evotor_uuid IS NOT NULL AND TRIM(evotor_uuid) <> ''
         AND COALESCE(enabled, 1) = 1`,
    )
    .all(storeUuid) as { productId: number; evotorUuid: string }[]
  for (const r of rows) map.set(Number(r.productId), String(r.evotorUuid))
  return map
}

/**
 * Возвращает `null`, если товара нет. Не бросает исключений: маршрут сам решает, что отдать.
 */
export function buildProductConfiguration(
  db: Database.Database,
  productId: number,
  storeUuid: string,
  now = Date.now(),
): ProductConfiguration | null {
  ensureMilkSchemeSchema(db)
  ensureAddonSchemeSchema(db)

  const product = db.prepare(`SELECT ${SKU_COLUMNS} FROM products p WHERE p.id=?`).get(productId) as SkuRow | undefined
  if (!product) return null

  const skus: SkuRow[] = product.groupId != null
    ? (db
        .prepare(
          `SELECT ${SKU_COLUMNS} FROM products p
           WHERE p.group_id=? AND COALESCE(p.is_group, 0) = 0
           ORDER BY COALESCE(p.variant_sort, 0), p.id`,
        )
        .all(product.groupId) as SkuRow[])
    : [product]
  // Запрошенный товар обязан присутствовать в списке объёмов (он может быть отдельной карточкой).
  if (!skus.some((s) => s.id === product.id)) skus.unshift(product)

  const uuidByProduct = uuidMapForStore(db, storeUuid)
  const groupSchemeId = product.groupId != null
    ? ((db.prepare('SELECT modifier_scheme_id AS s FROM product_groups WHERE id=?').get(product.groupId) as { s: number | null } | undefined)?.s ?? null)
    : null

  const configErrors: ProductConfiguration['configErrors'] = []
  const milkBySku: Record<string, ConfigMilkBlock | null> = {}
  const addonsBySku: Record<string, ConfigAddonsBlock | null> = {}
  let milkRequired = false
  let hasAddons = false

  for (const sku of skus) {
    // Молоко: только собственное назначение SKU (наследования от группы нет по модели БД).
    if (sku.milkSchemeId == null) {
      // Ключ присутствует у каждого объёма: пустые options = схемы нет (касса блок не рисует).
      milkBySku[String(sku.id)] = { schemeId: null, options: [] }
    } else {
      milkRequired = true
      const options = milkForProduct(db, Number(sku.milkSchemeId), uuidByProduct)
      if (!options.length) {
        milkBySku[String(sku.id)] = { schemeId: Number(sku.milkSchemeId), options: [], error: 'empty_scheme' }
        configErrors.push({
          productId: sku.id,
          code: 'milk_scheme_empty',
          message: 'Схема молока назначена и активна, но в ней нет доступных вариантов',
        })
      } else {
        milkBySku[String(sku.id)] = {
          schemeId: Number(sku.milkSchemeId),
          options: options.map((o) => ({
            id: o.id,
            productId: o.productId,
            label: o.label,
            evotorUuid: o.evotorUuid,
            isDefault: o.isDefault,
            isFree: o.isFree,
            sendToReceipt: o.sendToReceipt,
            sortOrder: o.sortOrder,
            available: o.available,
            notReadyReason: o.notReadyReason,
          })),
        }
      }
    }

    // Добавки: схема SKU приоритетнее схемы группы (та же логика, что в каталоге).
    const schemeId = effectiveSchemeId(db, sku.modifierSchemeId, groupSchemeId)
    if (schemeId == null) {
      addonsBySku[String(sku.id)] = { schemeId: null, options: [] }
    } else {
      const toppings = buildCatalogToppings(db, schemeId, uuidByProduct)
      if (!toppings.length) {
        addonsBySku[String(sku.id)] = { schemeId, options: [] }
      } else {
        hasAddons = true
        addonsBySku[String(sku.id)] = {
          schemeId,
          // Блок добавок необязателен всегда: кассир может не выбрать ни одной.
          options: toppings.map((t) => ({
            id: t.id,
            productId: t.productId,
            name: t.name,
            groupKey: t.groupKey,
            evotorUuid: t.evotorUuid,
            priceRub: t.priceRub,
            required: false,
            maxCount: t.maxCount,
            isDefault: t.isDefault,
            zeroOption: t.zeroOption,
            available: t.available,
            sendToReceipt: !t.zeroOption && t.price > 0,
          })),
        }
      }
    }
  }

  return {
    ok: true,
    schemaVersion: PRODUCT_CONFIG_SCHEMA_VERSION,
    storeUuid,
    productId: product.id,
    generatedAt: Math.floor(now / 1000),
    volumes: skus.map((s) => {
      const uuid = uuidByProduct.get(s.id) ?? null
      return {
        productId: s.id,
        evotorUuid: uuid,
        name: s.name,
        label: s.variantLabel ?? null,
        sizeValue: s.sizeValue ?? null,
        sizeUnit: s.sizeUnit ?? null,
        priceRub: Number(s.price) || 0,
        available: Number(s.available) !== 0 && uuid != null,
      }
    }),
    milk: milkRequired ? { required: true, byProductId: milkBySku } : null,
    additions: hasAddons ? { required: false, byProductId: addonsBySku } : null,
    configErrors,
  }
}
