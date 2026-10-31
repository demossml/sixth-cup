/**
 * Схема объёмов — отдельная сущность (не группа товаров, не схема добавок, не схема молока).
 *
 * Модель:
 *  • `volume_schemes` — именованный шаблон объёмов («Стандарт 200/300/400 мл»);
 *  • `volume_scheme_items` — объём: название, числовой размер, единица, порядок, активность;
 *  • `products.volume_scheme_id` — назначение схемы товару (nullable: без схемы — норма);
 *  • `product_volume_prices` — цена конкретного объёма у конкретного товара
 *    (нет строки — берётся базовая цена товара).
 *
 * Схема одна на многие товары, поэтому цены живут не в схеме, а в карточке товара.
 */
import type Database from 'better-sqlite3'
import { db as defaultDb } from '../../db'

export type VolumeItemInput = {
  id?: number
  label: string
  sizeValue: number | null
  sizeUnit: 'ml' | 'g' | null
  sortOrder: number
  active: boolean
}

export type VolumeSchemeInput = {
  id?: number
  name: string
  active: boolean
  items: VolumeItemInput[]
}

type ItemRow = {
  id: number
  scheme_id: number
  label: string
  size_value: number | null
  size_unit: string | null
  sort_order: number
  active: number
}

export function ensureVolumeSchemeSchema(conn: Database.Database = defaultDb) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS volume_schemes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS volume_scheme_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scheme_id INTEGER NOT NULL REFERENCES volume_schemes(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      size_value INTEGER,
      size_unit TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS product_volume_prices (
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES volume_scheme_items(id) ON DELETE CASCADE,
      price INTEGER NOT NULL,
      PRIMARY KEY (product_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_volume_items_scheme ON volume_scheme_items(scheme_id, sort_order, id);
  `)
  const cols = (conn.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('volume_scheme_id')) {
    conn.exec('ALTER TABLE products ADD COLUMN volume_scheme_id INTEGER REFERENCES volume_schemes(id)')
    conn.exec('CREATE INDEX IF NOT EXISTS idx_products_volume_scheme ON products(volume_scheme_id)')
  }
}

const viewItem = (r: ItemRow) => ({
  id: r.id,
  label: r.label,
  sizeValue: r.size_value,
  sizeUnit: (r.size_unit as 'ml' | 'g' | null) ?? null,
  sortOrder: r.sort_order,
  active: r.active === 1,
})

export function listVolumeSchemes(conn: Database.Database = defaultDb, opts: { includeInactive?: boolean } = {}) {
  ensureVolumeSchemeSchema(conn)
  const schemes = conn
    .prepare(`SELECT id, name, active, created_at AS createdAt, updated_at AS updatedAt FROM volume_schemes
              ${opts.includeInactive ? '' : 'WHERE active=1'} ORDER BY name, id`)
    .all() as { id: number; name: string; active: number; createdAt: number; updatedAt: number }[]
  const items = conn.prepare('SELECT * FROM volume_scheme_items ORDER BY scheme_id, sort_order, id').all() as ItemRow[]
  const byScheme = new Map<number, ReturnType<typeof viewItem>[]>()
  for (const it of items) {
    const list = byScheme.get(it.scheme_id) ?? []
    list.push(viewItem(it))
    byScheme.set(it.scheme_id, list)
  }
  const used = conn
    .prepare('SELECT volume_scheme_id AS id, COUNT(*) AS n FROM products WHERE volume_scheme_id IS NOT NULL GROUP BY volume_scheme_id')
    .all() as { id: number; n: number }[]
  const usedBy = new Map(used.map((u) => [u.id, u.n]))
  return schemes.map((s) => ({
    id: s.id,
    name: s.name,
    active: s.active === 1,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    items: byScheme.get(s.id) ?? [],
    usedByProducts: usedBy.get(s.id) ?? 0,
  }))
}

export function getVolumeScheme(id: number, conn: Database.Database = defaultDb) {
  return listVolumeSchemes(conn, { includeInactive: true }).find((s) => s.id === id) ?? null
}

/** Ошибка валидации схемы объёмов — текст уходит в 400 как есть. */
export class VolumeSchemeError extends Error {}

export function validateVolumeScheme(input: VolumeSchemeInput): void {
  const name = String(input.name ?? '').trim()
  if (!name) throw new VolumeSchemeError('Название схемы обязательно')
  if (name.length > 80) throw new VolumeSchemeError('Название схемы — не больше 80 символов')
  const items = input.items ?? []
  if (!items.length) throw new VolumeSchemeError('Добавьте хотя бы один объём')
  const seen = new Set<string>()
  for (const it of items) {
    const label = String(it.label ?? '').trim()
    if (!label) throw new VolumeSchemeError('У каждого объёма должно быть название')
    if (label.length > 24) throw new VolumeSchemeError(`Название объёма «${label}» — не больше 24 символов`)
    // «200 мл» и «200мл» — один и тот же объём, дублировать нельзя
    const key = label.toLowerCase().replace(/\s+/g, '')
    if (seen.has(key)) throw new VolumeSchemeError(`Объём «${label}» указан дважды`)
    seen.add(key)
    if (it.sizeValue != null && (!Number.isInteger(it.sizeValue) || it.sizeValue <= 0 || it.sizeValue > 100000)) {
      throw new VolumeSchemeError(`«${label}»: размер — целое число больше нуля`)
    }
    if ((it.sizeValue == null) !== (it.sizeUnit == null)) {
      throw new VolumeSchemeError(`«${label}»: укажите и число, и единицу (мл/г)`)
    }
  }
}

/** Создать или обновить схему (объёмы заменяются целиком — как в схемах молока и добавок). */
export function saveVolumeScheme(input: VolumeSchemeInput, conn: Database.Database = defaultDb) {
  ensureVolumeSchemeSchema(conn)
  validateVolumeScheme(input)
  const now = Date.now()
  const id = conn.transaction(() => {
    let schemeId = input.id ?? 0
    if (schemeId) {
      const exists = conn.prepare('SELECT 1 FROM volume_schemes WHERE id=?').get(schemeId)
      if (!exists) throw new VolumeSchemeError('Схема не найдена')
      conn.prepare('UPDATE volume_schemes SET name=?, active=?, updated_at=? WHERE id=?')
        .run(input.name.trim(), input.active ? 1 : 0, now, schemeId)
      conn.prepare('DELETE FROM volume_scheme_items WHERE scheme_id=?').run(schemeId)
    } else {
      const r = conn.prepare('INSERT INTO volume_schemes(name,active,created_at,updated_at) VALUES(?,?,?,?)')
        .run(input.name.trim(), input.active ? 1 : 0, now, now)
      schemeId = Number(r.lastInsertRowid)
    }
    const ins = conn.prepare(`INSERT INTO volume_scheme_items (scheme_id,label,size_value,size_unit,sort_order,active)
      VALUES(?,?,?,?,?,?)`)
    input.items.forEach((it, i) => {
      ins.run(
        schemeId,
        String(it.label).trim(),
        it.sizeValue ?? null,
        it.sizeUnit ?? null,
        Number.isFinite(it.sortOrder) ? Number(it.sortOrder) : i,
        it.active === false ? 0 : 1,
      )
    })
    return schemeId
  })()
  return getVolumeScheme(Number(id), conn)
}

/** Удаление запрещено, пока схема назначена товарам (иначе теряются назначения и цены). */
export function deleteVolumeScheme(id: number, conn: Database.Database = defaultDb) {
  ensureVolumeSchemeSchema(conn)
  const used = (conn.prepare('SELECT COUNT(*) AS n FROM products WHERE volume_scheme_id=?').get(id) as { n: number }).n
  if (used > 0) {
    throw new VolumeSchemeError(`Схема назначена ${used} товар(ам). Сначала снимите назначение или выключите схему`)
  }
  conn.transaction(() => {
    conn.prepare(`DELETE FROM product_volume_prices WHERE item_id IN (SELECT id FROM volume_scheme_items WHERE scheme_id=?)`).run(id)
    conn.prepare('DELETE FROM volume_scheme_items WHERE scheme_id=?').run(id)
    conn.prepare('DELETE FROM volume_schemes WHERE id=?').run(id)
  })()
}

export type ResolvedVolume = {
  itemId: number
  label: string
  sizeValue: number | null
  sizeUnit: 'ml' | 'g' | null
  price: number
  isDefault: boolean
  sortOrder: number
}

/**
 * Объёмы для каталога кассы: только активные объёмы активной схемы.
 * Цена — из карточки товара (`product_volume_prices`), иначе базовая цена товара.
 * Нет схемы → пустой массив (это норма, а не ошибка).
 */
export function volumesForProduct(
  conn: Database.Database,
  schemeId: number | null,
  productId: number,
  basePrice: number,
): ResolvedVolume[] {
  if (schemeId == null) return []
  ensureVolumeSchemeSchema(conn)
  const rows = conn
    .prepare(`SELECT i.* FROM volume_scheme_items i
              JOIN volume_schemes s ON s.id = i.scheme_id
              WHERE i.scheme_id=? AND i.active=1 AND s.active=1
              ORDER BY i.sort_order, i.id`)
    .all(schemeId) as ItemRow[]
  if (!rows.length) return []
  const prices = new Map<number, number>()
  const priceRows = conn
    .prepare('SELECT item_id AS itemId, price FROM product_volume_prices WHERE product_id=?')
    .all(productId) as { itemId: number; price: number }[]
  for (const p of priceRows) prices.set(p.itemId, p.price)
  const base = Number.isFinite(basePrice) ? basePrice : 0
  return rows.map((r, i) => ({
    itemId: r.id,
    label: r.label,
    sizeValue: r.size_value,
    sizeUnit: (r.size_unit as 'ml' | 'g' | null) ?? null,
    price: prices.get(r.id) ?? base,
    // Первый объём — предвыбранный на кассе (как «обычное молоко» в схеме молока).
    isDefault: i === 0,
    sortOrder: r.sort_order,
  }))
}

/** Цены объёмов из карточки товара: `itemId` чужой схемы игнорируется. */
export function saveProductVolumePrices(
  conn: Database.Database,
  productId: number,
  schemeId: number | null,
  prices: { itemId: number; price: number }[] | undefined,
) {
  if (prices === undefined) return
  ensureVolumeSchemeSchema(conn)
  conn.prepare('DELETE FROM product_volume_prices WHERE product_id=?').run(productId)
  if (schemeId == null || !prices.length) return
  const allowed = new Set(
    (conn.prepare('SELECT id FROM volume_scheme_items WHERE scheme_id=?').all(schemeId) as { id: number }[]).map((r) => r.id),
  )
  const ins = conn.prepare('INSERT OR REPLACE INTO product_volume_prices(product_id,item_id,price) VALUES(?,?,?)')
  for (const p of prices) {
    if (!allowed.has(p.itemId)) continue
    if (!Number.isFinite(p.price) || p.price < 0) continue
    ins.run(productId, p.itemId, Math.round(p.price))
  }
}

export function productVolumePrices(conn: Database.Database, productId: number) {
  ensureVolumeSchemeSchema(conn)
  return conn
    .prepare('SELECT item_id AS itemId, price FROM product_volume_prices WHERE product_id=? ORDER BY item_id')
    .all(productId) as { itemId: number; price: number }[]
}
