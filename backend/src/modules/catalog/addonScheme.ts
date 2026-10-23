/**
 * Addon / modifier schemes for cashier catalog.
 * Paid toppings = products (category «Добавки») with product_store_links UUID.
 * Zero-options = scheme rows without product (Обычное молоко, Без сиропа).
 */
import type Database from 'better-sqlite3'

export type SchemeItemRow = {
  id: number
  schemeId: number
  modifierId: number | null
  productId: number | null
  groupKey: string | null
  required: number
  maxCount: number
  isDefault: number
  zeroOption: number
  priceOverride: number | null
  nameOverride: string | null
  sortOrder: number
}

export type CatalogTopping = {
  id: number
  productId: number | null
  name: string
  price: number
  priceRub: number
  groupKey: string
  evotorUuid: string | null
  required: boolean
  maxCount: number
  isDefault: boolean
  zeroOption: boolean
  available: boolean
}

let ensured = false

export function ensureAddonSchemeSchema(db: Database.Database): void {
  if (ensured) return
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

  const modCols = cols('modifiers')
  if (modCols.length && !modCols.includes('linked_product_id')) {
    db.exec(`ALTER TABLE modifiers ADD COLUMN linked_product_id INTEGER REFERENCES products(id)`)
  }

  const itemCols = cols('modifier_scheme_items')
  if (!itemCols.length) {
    ensured = true
    return
  }
  if (!itemCols.includes('id') || !itemCols.includes('product_id')) {
    db.exec(`
CREATE TABLE IF NOT EXISTS modifier_scheme_items_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme_id INTEGER NOT NULL REFERENCES modifier_schemes(id) ON DELETE CASCADE,
  modifier_id INTEGER REFERENCES modifiers(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  group_key TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  max_count INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  zero_option INTEGER NOT NULL DEFAULT 0,
  price_override INTEGER,
  name_override TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO modifier_scheme_items_v2(scheme_id, modifier_id, required, max_count)
  SELECT scheme_id, modifier_id, required, max_count FROM modifier_scheme_items;
DROP TABLE modifier_scheme_items;
ALTER TABLE modifier_scheme_items_v2 RENAME TO modifier_scheme_items;
CREATE INDEX IF NOT EXISTS idx_msi_scheme ON modifier_scheme_items(scheme_id);
CREATE INDEX IF NOT EXISTS idx_msi_product ON modifier_scheme_items(product_id);
`)
  } else {
    const add = (name: string, sql: string) => {
      if (!itemCols.includes(name)) db.exec(sql)
    }
    add('product_id', `ALTER TABLE modifier_scheme_items ADD COLUMN product_id INTEGER REFERENCES products(id)`)
    add('group_key', `ALTER TABLE modifier_scheme_items ADD COLUMN group_key TEXT`)
    add('is_default', `ALTER TABLE modifier_scheme_items ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`)
    add('zero_option', `ALTER TABLE modifier_scheme_items ADD COLUMN zero_option INTEGER NOT NULL DEFAULT 0`)
    add('price_override', `ALTER TABLE modifier_scheme_items ADD COLUMN price_override INTEGER`)
    add('name_override', `ALTER TABLE modifier_scheme_items ADD COLUMN name_override TEXT`)
    add('sort_order', `ALTER TABLE modifier_scheme_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
  }
  ensured = true
}

export function resolveAddonsCategoryId(db: Database.Database): number | null {
  const byName = db
    .prepare(`SELECT id FROM categories WHERE lower(name) LIKE '%добавк%' ORDER BY id LIMIT 1`)
    .get() as { id: number } | undefined
  if (byName) return byName.id
  const env = Number(process.env.ADDONS_CATEGORY_ID || 0)
  return env > 0 ? env : null
}

export function listAddonProductIds(db: Database.Database): Set<number> {
  ensureAddonSchemeSchema(db)
  const catId = resolveAddonsCategoryId(db)
  const ids = new Set<number>()
  if (catId != null) {
    for (const r of db
      .prepare(`SELECT id FROM products WHERE available=1 AND category_id=?`)
      .all(catId) as { id: number }[]) {
      ids.add(r.id)
    }
  }
  for (const r of db
    .prepare(`SELECT DISTINCT product_id AS id FROM modifier_scheme_items WHERE product_id IS NOT NULL`)
    .all() as { id: number }[]) {
    ids.add(r.id)
  }
  try {
    for (const r of db
      .prepare(`SELECT DISTINCT linked_product_id AS id FROM modifiers WHERE linked_product_id IS NOT NULL`)
      .all() as { id: number }[]) {
      ids.add(r.id)
    }
  } catch { /* */ }
  return ids
}

export function loadSchemeItems(db: Database.Database, schemeId: number): SchemeItemRow[] {
  ensureAddonSchemeSchema(db)
  return db
    .prepare(
      `SELECT id, scheme_id AS schemeId, modifier_id AS modifierId, product_id AS productId,
              group_key AS groupKey, required, max_count AS maxCount,
              COALESCE(is_default,0) AS isDefault, COALESCE(zero_option,0) AS zeroOption,
              price_override AS priceOverride, name_override AS nameOverride,
              COALESCE(sort_order,0) AS sortOrder
       FROM modifier_scheme_items WHERE scheme_id=? ORDER BY sort_order, id`,
    )
    .all(schemeId) as SchemeItemRow[]
}

export function buildCatalogToppings(
  db: Database.Database,
  schemeId: number | null,
  uuidByProduct: Map<number, string>,
): CatalogTopping[] {
  if (schemeId == null) return []
  ensureAddonSchemeSchema(db)
  const items = loadSchemeItems(db, schemeId)
  const modRows = db
    .prepare(
      `SELECT id, name, price, group_key AS groupKey, available, linked_product_id AS linkedProductId
       FROM modifiers`,
    )
    .all() as {
    id: number
    name: string
    price: number
    groupKey: string
    available: number
    linkedProductId: number | null
  }[]
  const modById = new Map(modRows.map((m) => [m.id, m]))
  const prodRows = db
    .prepare(`SELECT id, name, price, available FROM products`)
    .all() as { id: number; name: string; price: number; available: number }[]
  const prodById = new Map(prodRows.map((p) => [p.id, p]))

  const out: CatalogTopping[] = []
  for (const it of items) {
    const zero = it.zeroOption === 1
    let productId: number | null = it.productId
    let name = (it.nameOverride || '').trim()
    let price: number | null = it.priceOverride
    let groupKey = (it.groupKey || '').trim()
    let modAvailable = true

    if (it.modifierId != null) {
      const m = modById.get(it.modifierId)
      if (!m) continue
      if (!name) name = m.name
      if (price == null) price = m.price
      if (!groupKey) groupKey = m.groupKey || 'extra'
      modAvailable = m.available !== 0
      // TZ §11: uuid only via explicit productId on item or modifiers.linked_product_id — no name-match
      if (productId == null && m.linkedProductId != null) productId = m.linkedProductId
    }

    if (productId != null) {
      const p = prodById.get(productId)
      if (!p) {
        if (!zero) continue
      } else {
        if (!name) name = p.name
        if (price == null) price = p.price
        if (p.available === 0) modAvailable = false
      }
    }

    if (zero) {
      if (!name) name = groupKey === 'milk' ? 'Обычное' : groupKey === 'syrup' ? 'Без сиропа' : 'Без добавки'
      price = 0
      productId = null
    }

    if (!name) continue
    if (price == null) price = 0
    if (!groupKey) groupKey = 'extra'
    if (groupKey === 'other' || groupKey === 'topping') groupKey = 'extra'

    const uuid = productId != null ? uuidByProduct.get(productId) ?? null : null
    const paid = !zero && price > 0
    const available = zero ? true : modAvailable && (paid ? uuid != null : true)

    out.push({
      id: it.id,
      productId,
      name,
      price,
      priceRub: price,
      groupKey,
      evotorUuid: zero ? null : uuid,
      required: it.required === 1,
      maxCount: it.maxCount || 1,
      isDefault: it.isDefault === 1,
      zeroOption: zero,
      available,
    })
  }
  return out
}

export function replaceSchemeItems(
  db: Database.Database,
  schemeId: number,
  items: {
    modifierId?: number | null
    productId?: number | null
    groupKey?: string | null
    required?: boolean
    maxCount?: number
    isDefault?: boolean
    zeroOption?: boolean
    priceOverride?: number | null
    nameOverride?: string | null
    sortOrder?: number
  }[],
): void {
  ensureAddonSchemeSchema(db)
  db.prepare(`DELETE FROM modifier_scheme_items WHERE scheme_id=?`).run(schemeId)
  const ins = db.prepare(
    `INSERT INTO modifier_scheme_items(
      scheme_id, modifier_id, product_id, group_key, required, max_count,
      is_default, zero_option, price_override, name_override, sort_order
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const lockedDefault = new Set<string>()
  let sort = 0
  for (const raw of items) {
    const zero = !!raw.zeroOption
    const productId = raw.productId != null ? Number(raw.productId) : null
    const modifierId = raw.modifierId != null ? Number(raw.modifierId) : null
    if (!zero && productId == null && modifierId == null) continue
    let groupKey = (raw.groupKey || '').trim() || null
    if (groupKey === 'other' || groupKey === 'topping') groupKey = 'extra'
    let isDefaultVal = 0
    if (raw.isDefault && groupKey && !lockedDefault.has(groupKey)) {
      isDefaultVal = 1
      lockedDefault.add(groupKey)
    }
    ins.run(
      schemeId,
      zero ? null : modifierId,
      zero ? null : productId,
      groupKey,
      raw.required ? 1 : 0,
      raw.maxCount ?? (groupKey === 'milk' || groupKey === 'syrup' ? 1 : 2),
      isDefaultVal,
      zero ? 1 : 0,
      zero ? 0 : (raw.priceOverride ?? null),
      raw.nameOverride ?? null,
      raw.sortOrder ?? sort++,
    )
  }
}
