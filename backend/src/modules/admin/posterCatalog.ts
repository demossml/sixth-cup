/**
 * Каталог для конструктора «Меню и Ценники»: товары с размерами и ценами, виды молока с доплатой.
 *
 * Товар в меню — это то, что гость видит одной строкой: группа размеров («Капучино» = товары
 * 250 / 350 / 400 мл, у каждого своя цена) или одиночный товар (размеры — из схемы объёмов, если
 * она есть, иначе одна базовая цена). Цены в рублях, одинаковые для всех точек.
 */
import type Database from 'better-sqlite3'
import type { Catalog, CatalogMilk, CatalogProduct, CatalogSize } from '@sixth-cup/menu-core/catalog'
import { resolveAddonsCategoryIds } from '../catalog/addonScheme'

type ProductRow = {
  id: number
  name: string
  price: number
  available: number
  categoryId: number | null
  categoryName: string | null
  groupId: number | null
  variantLabel: string | null
  sizeValue: number | null
  sizeUnit: string | null
  volumeSchemeId: number | null
  milkSchemeId: number | null
}

const sizeLabel = (r: Pick<ProductRow, 'variantLabel' | 'sizeValue' | 'sizeUnit'>): string =>
  r.variantLabel?.trim() ||
  (r.sizeValue != null && r.sizeUnit ? `${r.sizeValue} ${r.sizeUnit === 'ml' ? 'мл' : r.sizeUnit === 'g' ? 'г' : r.sizeUnit}` : 'цена')

export function buildPosterCatalog(db: Database.Database): Catalog {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.price, p.available, p.category_id AS categoryId, c.name AS categoryName,
              p.group_id AS groupId, p.variant_label AS variantLabel, p.size_value AS sizeValue, p.size_unit AS sizeUnit,
              p.volume_scheme_id AS volumeSchemeId, p.milk_scheme_id AS milkSchemeId
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE COALESCE(p.is_group, 0) = 0
        ORDER BY c.sort_order, p.sort_order, p.variant_sort, p.id`,
    )
    .all() as ProductRow[]

  const groups = db
    .prepare(
      `SELECT g.id, g.name, g.category_id AS categoryId, c.name AS categoryName
         FROM product_groups g LEFT JOIN categories c ON c.id = g.category_id
        ORDER BY c.sort_order, g.sort_order, g.id`,
    )
    .all() as { id: number; name: string; categoryId: number | null; categoryName: string | null }[]

  // Объёмы схемы — только активные позиции текущей схемы товара.
  const volumeRows = db
    .prepare(
      `SELECT pvp.product_id AS productId, v.id AS itemId, v.label, pvp.price
         FROM product_volume_prices pvp
         JOIN volume_scheme_items v ON v.id = pvp.item_id AND v.active = 1
         JOIN products p ON p.id = pvp.product_id AND p.volume_scheme_id = v.scheme_id
         JOIN volume_schemes s ON s.id = v.scheme_id AND s.active = 1
        ORDER BY v.sort_order, v.id`,
    )
    .all() as { productId: number; itemId: number; label: string; price: number }[]
  const volumes = new Map<number, CatalogSize[]>()
  for (const r of volumeRows) {
    const list = volumes.get(r.productId) ?? []
    list.push({ key: `v:${r.itemId}`, label: r.label, price: Number(r.price) || 0 })
    volumes.set(r.productId, list)
  }

  // Молоко: доплата = цена привязанного товара варианта, 0 — если вариант бесплатный (как в buildMilk).
  const milkRows = db
    .prepare(
      `SELECT v.id, v.scheme_id AS schemeId, v.label, v.is_free AS isFree, COALESCE(p.price, 0) AS productPrice
         FROM milk_scheme_variants v
         JOIN milk_schemes s ON s.id = v.scheme_id AND s.active = 1
         LEFT JOIN products p ON p.id = v.product_id
        WHERE v.active = 1
        ORDER BY v.sort_order, v.id`,
    )
    .all() as { id: number; schemeId: number; label: string; isFree: number; productPrice: number }[]
  const milk = new Map<number, CatalogMilk[]>()
  for (const r of milkRows) {
    const list = milk.get(r.schemeId) ?? []
    list.push({ id: Number(r.id), label: r.label, surcharge: r.isFree === 1 ? 0 : Number(r.productPrice) || 0 })
    milk.set(r.schemeId, list)
  }

  const addonCats = new Set(resolveAddonsCategoryIds(db))
  const isAddon = (categoryId: number | null) => categoryId != null && addonCats.has(categoryId)
  const products: CatalogProduct[] = []

  const variantsByGroup = new Map<number, ProductRow[]>()
  for (const r of rows) {
    if (r.groupId == null) continue
    const list = variantsByGroup.get(r.groupId) ?? []
    list.push(r)
    variantsByGroup.set(r.groupId, list)
  }
  for (const g of groups) {
    const variants = variantsByGroup.get(g.id) ?? []
    if (!variants.length) continue
    const scheme = variants.find((v) => v.milkSchemeId != null)?.milkSchemeId
    products.push({
      id: `g:${g.id}`,
      name: g.name,
      category: g.categoryName ?? variants[0].categoryName,
      addon: isAddon(g.categoryId ?? variants[0].categoryId),
      available: variants.some((v) => v.available === 1),
      sizes: variants.map((v) => ({ key: `p:${v.id}`, label: sizeLabel(v), price: Number(v.price) || 0 })),
      milk: scheme != null ? (milk.get(scheme) ?? []) : [],
    })
  }

  for (const r of rows) {
    if (r.groupId != null) continue
    products.push({
      id: `p:${r.id}`,
      name: r.name,
      category: r.categoryName,
      addon: isAddon(r.categoryId),
      available: r.available === 1,
      sizes: volumes.get(r.id) ?? [{ key: `p:${r.id}`, label: sizeLabel(r), price: Number(r.price) || 0 }],
      milk: r.milkSchemeId != null ? (milk.get(r.milkSchemeId) ?? []) : [],
    })
  }
  return { products }
}
