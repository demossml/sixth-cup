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

/**
 * Канонический словарь групп добавок — единственный источник для админки, каталога и валидации.
 * Платная «Топпинг»/«Другое» в UI сохраняются как `extra`: касса трактует их одной группой.
 */
export const ADDON_GROUP_KEYS = ['milk', 'syrup', 'sugar', 'extra'] as const
export type AddonGroupKey = (typeof ADDON_GROUP_KEYS)[number]

export const ADDON_GROUPS: ReadonlyArray<{ key: AddonGroupKey; label: string }> = [
  { key: 'milk', label: 'Молоко' },
  { key: 'syrup', label: 'Сироп' },
  { key: 'sugar', label: 'Сахар' },
  { key: 'extra', label: 'Дополнительно' },
]

const ADDON_GROUP_ALIASES: Record<string, AddonGroupKey> = {
  milk: 'milk',
  'молоко': 'milk',
  syrup: 'syrup',
  'сироп': 'syrup',
  sugar: 'sugar',
  'сахар': 'sugar',
  extra: 'extra',
  topping: 'extra',
  'топпинг': 'extra',
  other: 'extra',
  'прочее': 'extra',
  'добавки': 'extra',
  'добавка': 'extra',
  'дополнительно': 'extra',
}

/** Синоним/кириллица → канонический ключ; неизвестное → null (мусор не проходит). */
export function resolveAddonGroupKey(value: unknown): AddonGroupKey | null {
  const key = normName(value)
  if (!key) return null
  return ADDON_GROUP_ALIASES[key] ?? null
}

/** Мягкая нормализация для данных из БД и старых клиентов: неизвестное → extra. */
export function normalizeAddonGroupKey(value: unknown): AddonGroupKey {
  return resolveAddonGroupKey(value) ?? 'extra'
}

/** Лимит по умолчанию для группы: extra — 2 разные опции, одиночные группы — 1. */
export function defaultAddonMaxCount(groupKey: AddonGroupKey): number {
  return groupKey === 'extra' ? 2 : 1
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

  // 029: канон options получил price_override — добавляем и на БД, где миграция ещё не прошла.
  const optionCols = cols('modifier_scheme_options')
  if (optionCols.length && !optionCols.includes('price_override')) {
    db.exec(`ALTER TABLE modifier_scheme_options ADD COLUMN price_override INTEGER`)
  }
  ensured = true
}

const normName = (v: unknown) =>
  String(v ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

/**
 * Все категории-добавки. В БД может оказаться больше одной: guard в миграции 027
 * использует SQLite lower(), который не складывает кириллицу, поэтому дубль создаётся
 * на базе, где категория уже была заведена приложением.
 */
export function resolveAddonsCategoryIds(db: Database.Database): number[] {
  const rows = db.prepare('SELECT id, name FROM categories ORDER BY id').all() as { id: number; name: string }[]
  const ids = rows.filter((r) => normName(r.name).includes('добавк')).map((r) => r.id)
  const env = Number(process.env.ADDONS_CATEGORY_ID || 0)
  if (env > 0 && rows.some((r) => r.id === env) && !ids.includes(env)) ids.unshift(env)
  return ids
}

export function resolveAddonsCategoryId(db: Database.Database): number | null {
  const ids = resolveAddonsCategoryIds(db)
  return ids.length ? ids[0] : null
}

/**
 * Схлопывает категории с одинаковым нормализованным названием (точные дубли).
 * Товары и группы переносятся в оставшуюся категорию, лишние строки удаляются.
 * Возвращает число удалённых категорий.
 */
export function dedupeCategoriesByName(db: Database.Database): number {
  const rows = db.prepare('SELECT id, name FROM categories ORDER BY id').all() as { id: number; name: string }[]
  const keep = new Map<string, number>()
  const dups: { id: number; keepId: number }[] = []
  for (const r of rows) {
    const key = normName(r.name)
    const kept = keep.get(key)
    if (kept === undefined) keep.set(key, r.id)
    else dups.push({ id: r.id, keepId: kept })
  }
  if (!dups.length) return 0

  const hasProductGroups = !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_groups'")
    .get()

  db.transaction(() => {
    for (const d of dups) {
      db.prepare('UPDATE products SET category_id=? WHERE category_id=?').run(d.keepId, d.id)
      if (hasProductGroups) db.prepare('UPDATE product_groups SET category_id=? WHERE category_id=?').run(d.keepId, d.id)
      db.prepare('DELETE FROM categories WHERE id=?').run(d.id)
    }
  })()
  return dups.length
}

/** Категория «Добавки»; если нет — создаём. */
export function ensureAddonsCategory(db: Database.Database): number {
  const have = resolveAddonsCategoryId(db)
  if (have != null) return have
  const t = Date.now()
  const r = db.prepare('INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,1,?,?)')
    .run('Добавки', 90, t, t)
  return Number(r.lastInsertRowid)
}

/**
 * Одна добавка справочника ↔ товар категории «Добавки» (для UUID Эвотор).
 * Поиск одноимённого — только в категории «Добавки» (не привязываем напиток с тем же именем).
 */
/** Canonical Evotor group name for a modifier group_key. */
export function groupNameForKey(groupKey: unknown): string {
  const k = normName(groupKey)
  if (k === 'milk' || k === 'молоко') return 'Молоко'
  if (k === 'syrup' || k === 'сироп') return 'Сиропы'
  if (k === 'sugar' || k === 'сахар') return 'Сахар'
  return 'Добавки'
}

/** Ensure a group product (is_group=1) exists for the given group_key; return its id. */
export function ensureAddonGroupProduct(db: Database.Database, groupKey: unknown): number {
  ensureAddonSchemeSchema(db)
  const cat = ensureAddonsCategory(db)
  const name = groupNameForKey(groupKey)
  const t = Date.now()
  // Defensive columns (027 may not have run yet in some test DBs)
  const cols = (db.prepare(`PRAGMA table_info(products)`).all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('is_group')) db.exec(`ALTER TABLE products ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0`)
  if (!cols.includes('parent_product_id')) db.exec(`ALTER TABLE products ADD COLUMN parent_product_id INTEGER REFERENCES products(id)`)

  const existing = db
    .prepare(`SELECT id FROM products WHERE is_group=1 AND name=? ORDER BY id LIMIT 1`)
    .get(name) as { id: number } | undefined
  if (existing) return existing.id

  const sort =
    name === 'Молоко' ? 10 : name === 'Сиропы' ? 20 : name === 'Сахар' ? 30 : 40
  const r = db
    .prepare(
      `INSERT INTO products(name,price,icon,available,category_id,sort_order,created_at,updated_at,
        counts_as_cup,free_eligible,tax,measure,cost_price_kopecks,catalog_source,is_group)
       VALUES(?,0,'Folder',1,?,?,?,?,0,0,'NO_VAT','шт',0,'SIXTH_CUP',1)`,
    )
    .run(name, cat, sort, t, t)
  return Number(r.lastInsertRowid)
}

/**
 * Одна добавка справочника ↔ товар категории «Добавки» (для UUID Эвотор).
 * Поиск одноимённого — только в категории «Добавки» (не привязываем напиток с тем же именем).
 * После синка товар получает parent_product_id → группу (Молоко/Сиропы/…), как parentUuid в Эвоторе.
 */
export function syncModifierProduct(db: Database.Database, modifierId: number): number | null {
  const m = db
    .prepare('SELECT id, name, price, available, group_key AS groupKey, linked_product_id AS pid FROM modifiers WHERE id=?')
    .get(modifierId) as {
    id: number
    name: string
    price: number
    available: number
    groupKey: string | null
    pid: number | null
  } | undefined
  if (!m) return null
  const cat = ensureAddonsCategory(db)
  const t = Date.now()
  const groupId = ensureAddonGroupProduct(db, m.groupKey)

  let pid: number | null = m.pid != null && db.prepare('SELECT 1 FROM products WHERE id=?').get(m.pid) ? m.pid : null
  if (pid == null) {
    // Owner decision (A1): adopt ONLY a product that already sits in «Добавки» and is not
    // claimed by another modifier. Retail products are never pulled into «Добавки» just
    // because the name matches — two different SKUs may share a name.
    const taken = new Set(
      (
        db.prepare('SELECT linked_product_id AS pid FROM modifiers WHERE linked_product_id IS NOT NULL AND id<>?')
          .all(m.id) as { pid: number }[]
      ).map((r) => Number(r.pid)),
    )
    const candidates = db
      .prepare(
        `SELECT id, name FROM products
         WHERE category_id=? AND COALESCE(is_group,0)=0
         ORDER BY id`,
      )
      .all(cat) as { id: number; name: string }[]
    const wanted = normName(m.name)
    const found = candidates.find((x) => !taken.has(x.id) && normName(x.name) === wanted)
    pid = found ? found.id : null
  }
  if (pid != null) {
    db.prepare(
      `UPDATE products SET price=?, available=?, category_id=?, counts_as_cup=0, free_eligible=0,
                parent_product_id=?, is_group=0, updated_at=?, catalog_source='SIXTH_CUP' WHERE id=?`,
    ).run(m.price, m.available ? 1 : 0, cat, groupId, t, pid)
  } else {
    const r = db
      .prepare(
        `INSERT INTO products(name,price,icon,available,category_id,sort_order,created_at,updated_at,
        counts_as_cup,free_eligible,tax,measure,cost_price_kopecks,catalog_source,is_group,parent_product_id)
        VALUES(?,?,?,?,?,?,?,?,0,0,'NO_VAT','шт',0,'SIXTH_CUP',0,?)`,
      )
      .run(m.name, m.price, 'Coffee', m.available ? 1 : 0, cat, 0, t, t, groupId)
    pid = Number(r.lastInsertRowid)
  }
  db.prepare('UPDATE modifiers SET linked_product_id=? WHERE id=?').run(pid, m.id)
  return pid
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
      .prepare(`SELECT DISTINCT product_id AS id FROM modifier_scheme_options WHERE product_id IS NOT NULL`)
      .all() as { id: number }[]) {
      ids.add(r.id)
    }
  } catch { /* options table may be missing on very old DBs */ }
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

/** Есть ли у схемы канонические опции (modifier_scheme_options). */
export function schemeHasOptions(db: Database.Database, schemeId: number): boolean {
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM modifier_scheme_options WHERE scheme_id=?')
      .get(schemeId) as { n: number } | undefined
    return Number(row?.n ?? 0) > 0
  } catch {
    return false
  }
}

/** id схем, где используется модификатор: канон (options) + легаси (items). */
export function schemeIdsUsingModifier(db: Database.Database, modifierId: number): number[] {
  const ids = new Set<number>()
  try {
    for (const r of db
      .prepare('SELECT DISTINCT scheme_id AS id FROM modifier_scheme_options WHERE modifier_id=?')
      .all(modifierId) as { id: number }[]) {
      ids.add(Number(r.id))
    }
  } catch { /* options table may be missing */ }
  for (const r of db
    .prepare('SELECT DISTINCT scheme_id AS id FROM modifier_scheme_items WHERE modifier_id=?')
    .all(modifierId) as { id: number }[]) {
    ids.add(Number(r.id))
  }
  return [...ids]
}

/** Проекция options → легаси-форма items для совместимости старой админки (в БД не пишется). */
export function schemeItemsFromOptions(
  options: Array<{
    id: number
    schemeId: number
    kind: string
    productId: number | null
    modifierId: number | null
    name: string | null
    groupKey: string
    isDefault: boolean
    required: boolean
    maxCount: number
    priceOverride?: number | null
    sortOrder: number
  }>,
): SchemeItemRow[] {
  return options.map((o) => ({
    id: o.id,
    schemeId: o.schemeId,
    modifierId: o.kind === 'modifier' ? o.modifierId : null,
    productId: o.kind === 'zero' ? null : o.productId,
    groupKey: o.groupKey,
    required: o.required ? 1 : 0,
    maxCount: o.maxCount,
    isDefault: o.isDefault ? 1 : 0,
    zeroOption: o.kind === 'zero' ? 1 : 0,
    priceOverride: o.priceOverride ?? null,
    nameOverride: o.name,
    sortOrder: o.sortOrder,
  }))
}

/** Вход легаси-контракта items (что присылает старая админка) → строки options. */
export function itemsPayloadToOptions(
  items: {
    modifierId?: number | null
    productId?: number | null
    groupKey?: string | null
    required?: boolean | number
    maxCount?: number
    isDefault?: boolean | number
    zeroOption?: boolean | number
    priceOverride?: number | null
    nameOverride?: string | null
    sortOrder?: number
  }[],
) {
  return items.map((it, idx) => {
    const zero = !!it.zeroOption
    const kind = zero ? 'zero' : it.modifierId != null ? 'modifier' : 'product'
    return {
      kind,
      productId: zero ? null : (it.productId ?? null),
      modifierId: zero || kind === 'product' ? null : (it.modifierId ?? null),
      name: it.nameOverride ?? null,
      groupKey: normalizeAddonGroupKey(it.groupKey),
      isDefault: !!it.isDefault,
      required: !!it.required,
      maxCount: it.maxCount ?? 1,
      priceOverride: zero ? null : (it.priceOverride ?? null),
      sortOrder: it.sortOrder ?? idx,
    }
  })
}

/**
 * Одноразовая конверсия легаси items → options.
 * Нужна схемам, созданным до появления options: после конверсии канон один.
 */
export function convertLegacyItemsToOptions(db: Database.Database, schemeId: number): number {
  if (schemeHasOptions(db, schemeId)) return 0
  const items = loadSchemeItems(db, schemeId)
  if (!items.length) return 0
  replaceSchemeOptions(db, schemeId, itemsPayloadToOptions(items))
  db.prepare('DELETE FROM modifier_scheme_items WHERE scheme_id=?').run(schemeId)
  return items.length
}

function withZeroDefaults(schemeId: number, list: CatalogTopping[]): CatalogTopping[] {
  const spec: [string, string, number][] = [['milk', 'Обычное', 1], ['syrup', 'Без сиропа', 2]]
  for (const [key, label, n] of spec) {
    const inGroup = list.filter((x) => x.groupKey === key)
    if (!inGroup.length || inGroup.some((x) => x.zeroOption)) continue
    const hasDefault = inGroup.some((x) => x.isDefault)
    list.unshift({
      id: -(schemeId * 10 + n), productId: null, name: label, price: 0, priceRub: 0, groupKey: key,
      evotorUuid: null, required: false, maxCount: 1, isDefault: !hasDefault, zeroOption: true, available: true,
    })
  }
  return list
}

export function buildCatalogToppings(
  db: Database.Database,
  schemeId: number | null,
  uuidByProduct: Map<number, string>,
  /** Per-request cache: the catalog asks for the same scheme once per product. */
  cache?: Map<number, CatalogTopping[]>,
): CatalogTopping[] {
  if (schemeId == null) return []
  const cached = cache?.get(schemeId)
  if (cached) return [...cached]
  const built = withZeroDefaults(schemeId, buildCatalogToppingsRaw(db, schemeId, uuidByProduct))
  cache?.set(schemeId, built)
  return [...built]
}

function buildCatalogToppingsRaw(
  db: Database.Database,
  schemeId: number,
  uuidByProduct: Map<number, string>,
): CatalogTopping[] {
  ensureAddonSchemeSchema(db)

  // TZ Claude: если есть modifier_scheme_options — они главный источник (product/zero/modifier).
  let optionRows: Array<{
    id: number
    kind: string
    productId: number | null
    modifierId: number | null
    name: string | null
    groupKey: string
    isDefault: number
    required: number
    maxCount: number
    priceOverride: number | null
  }> = []
  try {
    optionRows = db
      .prepare(
        `SELECT id, kind, product_id AS productId, modifier_id AS modifierId, name,
                group_key AS groupKey, is_default AS isDefault, required, max_count AS maxCount,
                price_override AS priceOverride
         FROM modifier_scheme_options WHERE scheme_id=? ORDER BY sort_order, id`,
      )
      .all(schemeId) as typeof optionRows
  } catch {
    optionRows = []
  }

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

  const normKey = normalizeAddonGroupKey

  const out: CatalogTopping[] = []

  if (optionRows.length) {
    for (const it of optionRows) {
      const kind = it.kind
      let name = (it.name || '').trim()
      let price = 0
      let productId: number | null = it.productId
      let groupKey = normKey(it.groupKey)
      let modAvailable = true
      let zero = kind === 'zero'

      if (kind === 'product' && productId != null) {
        const p = prodById.get(productId)
        if (!p) continue
        if (!name) name = p.name
        price = p.price
        if (p.available === 0) modAvailable = false
      } else if (kind === 'modifier' && it.modifierId != null) {
        const m = modById.get(it.modifierId)
        if (!m) continue
        if (!name) name = m.name
        price = m.price
        groupKey = normKey(m.groupKey || groupKey)
        modAvailable = m.available !== 0
        if (productId == null && m.linkedProductId != null) productId = m.linkedProductId
      } else if (kind === 'zero') {
        if (!name) name = groupKey === 'milk' ? 'Обычное' : groupKey === 'syrup' ? 'Без сиропа' : 'Без добавки'
        price = 0
        productId = null
      } else {
        continue
      }

      if (!name) continue
      if (it.priceOverride != null) price = Number(it.priceOverride)
      const uuid = productId != null ? uuidByProduct.get(productId) ?? null : null
      const paid = !zero && price > 0
      const available = zero ? true : modAvailable && (paid ? uuid != null : true)
      out.push({
        id: it.id,
        productId: zero ? null : productId,
        name,
        price,
        priceRub: price,
        groupKey,
        evotorUuid: zero ? null : uuid,
        required: !!it.required,
        maxCount: it.maxCount || 1,
        isDefault: it.isDefault === 1,
        zeroOption: zero,
        available,
      })
    }
    return out
  }

  // Legacy: modifier_scheme_items (+ product_id / zero_option из 025)
  const items = loadSchemeItems(db, schemeId)
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
      // TZ: uuid only productId or linked_product_id — no name-match
      if (productId == null && m.linkedProductId != null) productId = m.linkedProductId
    }

    if (productId != null) {
      const pr = prodById.get(productId)
      if (!pr) {
        if (!zero) continue
      } else {
        if (!name) name = pr.name
        if (price == null) price = pr.price
        if (pr.available === 0) modAvailable = false
      }
    }

    if (zero) {
      if (!name) name = groupKey === 'milk' || groupKey === 'молоко' ? 'Обычное' : groupKey === 'syrup' || groupKey === 'сироп' ? 'Без сиропа' : 'Без добавки'
      price = 0
      productId = null
    }

    if (!name) continue
    if (price == null) price = 0
    groupKey = normKey(groupKey || 'extra')
    const uuid = productId != null ? uuidByProduct.get(productId) ?? null : null
    const paid = !zero && price > 0
    const available = zero ? true : modAvailable && (paid ? uuid != null : true)
    out.push({
      id: it.id,
      productId: zero ? null : productId,
      name,
      price,
      priceRub: price,
      groupKey,
      evotorUuid: zero ? null : uuid,
      required: !!it.required,
      maxCount: it.maxCount || 1,
      isDefault: it.isDefault === 1,
      zeroOption: zero,
      available,
    })
  }
  return out
}


/**
 * Легаси-запись в modifier_scheme_items.
 * @deprecated Канон схемы — modifier_scheme_options ([replaceSchemeOptions]); маршруты админки
 * больше не пишут items. Функция сохранена только для совместимости внешних вызовов.
 */
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


export function loadSchemeOptions(db: Database.Database, schemeId: number) {
  try {
    return db
      .prepare(
        `SELECT id, scheme_id AS schemeId, kind, product_id AS productId, modifier_id AS modifierId,
                name, group_key AS groupKey, is_default AS isDefault, required, max_count AS maxCount,
                COALESCE(price_override, 0) AS priceOverride, sort_order AS sortOrder
         FROM modifier_scheme_options WHERE scheme_id=? ORDER BY sort_order, id`,
      )
      .all(schemeId)
      .map((o: any) => ({
        id: o.id,
        schemeId: o.schemeId,
        kind: o.kind,
        productId: o.productId,
        modifierId: o.modifierId,
        name: o.name,
        groupKey: o.groupKey,
        isDefault: !!o.isDefault,
        required: !!o.required,
        maxCount: o.maxCount,
        priceOverride: o.priceOverride ? Number(o.priceOverride) : null,
        sortOrder: o.sortOrder,
      }))
  } catch {
    return []
  }
}

export function replaceSchemeOptions(
  db: Database.Database,
  schemeId: number,
  options: Array<{
    kind: string
    productId?: number | null
    modifierId?: number | null
    name?: string | null
    groupKey?: string
    isDefault?: boolean
    required?: boolean
    maxCount?: number
    priceOverride?: number | null
    sortOrder?: number
  }>,
) {
  // id опции — это `Topping.id`, на который ссылаются строки корзины и чека.
  // Поэтому обновляем позиции на месте, а не удаляем/вставляем: иначе повторное сохранение
  // схемы «теряет» уже выбранные добавки (ReceiptValidator → option_removed).
  const existing = (db.prepare(
    'SELECT id FROM modifier_scheme_options WHERE scheme_id=? ORDER BY sort_order, id',
  ).all(schemeId) as { id: number }[]).map((r) => r.id)
  const upd = db.prepare(
    `UPDATE modifier_scheme_options
        SET kind=?, product_id=?, modifier_id=?, name=?, group_key=?, is_default=?, required=?,
            max_count=?, price_override=?, sort_order=?
      WHERE id=?`,
  )
  const ins = db.prepare(
    `INSERT INTO modifier_scheme_options(scheme_id, kind, product_id, modifier_id, name, group_key, is_default, required, max_count, price_override, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  // Уникальный индекс допускает один default на группу — снимаем флаги до перезаписи.
  db.prepare('UPDATE modifier_scheme_options SET is_default=0 WHERE scheme_id=?').run(schemeId)
  options.forEach((o, idx) => {
    const kind = o.kind
    const groupKey = normalizeAddonGroupKey(o.groupKey)
    const values = [
      kind,
      kind === 'zero' ? null : o.productId ?? null,
      kind === 'modifier' ? o.modifierId ?? null : null,
      o.name ?? null,
      groupKey,
      o.isDefault ? 1 : 0,
      o.required ? 1 : 0,
      o.maxCount ?? defaultAddonMaxCount(groupKey),
      kind === 'zero' ? null : (o.priceOverride ?? null),
      o.sortOrder ?? idx,
    ] as const
    const id = existing[idx]
    if (id != null) upd.run(...values, id)
    else ins.run(schemeId, ...values)
  })
  for (let i = options.length; i < existing.length; i++) {
    db.prepare('DELETE FROM modifier_scheme_options WHERE id=?').run(existing[i])
  }
}
