/**
 * Схема молока — отдельная сущность (не часть схемы добавок).
 *
 * Модель:
 *  • `milk_schemes` — именованный набор вариантов молока для товара;
 *  • `milk_scheme_variants` — вариант: локальный товар Эвотор (`product_id`), признаки
 *    «бесплатный» / «по умолчанию» / «передавать в чек», порядок, активность;
 *  • `products.milk_scheme_id` — назначение схемы товару (nullable: без схемы — норма).
 *
 * UUID варианта НЕ хранится: он резолвится по точке через `product_store_links`
 * (у товара Эвотор нет одного UUID на все магазины).
 */
import type Database from 'better-sqlite3'
import { db as defaultDb } from '../../db'

export type MilkVariantInput = {
  id?: number
  productId: number | null
  label: string
  isDefault: boolean
  isFree: boolean
  sendToReceipt: boolean
  sortOrder: number
  active: boolean
}

export type MilkSchemeInput = {
  id?: number
  name: string
  active: boolean
  variants: MilkVariantInput[]
}

type VariantRow = {
  id: number
  scheme_id: number
  product_id: number | null
  label: string
  is_default: number
  is_free: number
  send_to_receipt: number
  sort_order: number
  active: number
}

export function ensureMilkSchemeSchema(conn: Database.Database = defaultDb) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS milk_schemes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS milk_scheme_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scheme_id INTEGER NOT NULL REFERENCES milk_schemes(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      label TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_free INTEGER NOT NULL DEFAULT 0,
      send_to_receipt INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_milk_variants_scheme ON milk_scheme_variants(scheme_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_milk_variants_product ON milk_scheme_variants(product_id);
  `)
  const cols = (conn.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('milk_scheme_id')) {
    conn.exec('ALTER TABLE products ADD COLUMN milk_scheme_id INTEGER REFERENCES milk_schemes(id)')
    conn.exec('CREATE INDEX IF NOT EXISTS idx_products_milk_scheme ON products(milk_scheme_id)')
  }
}

const viewVariant = (v: VariantRow) => ({
  id: v.id,
  productId: v.product_id,
  label: v.label,
  isDefault: v.is_default === 1,
  isFree: v.is_free === 1,
  sendToReceipt: v.send_to_receipt === 1,
  sortOrder: v.sort_order,
  active: v.active === 1,
})

export function listMilkSchemes(conn: Database.Database = defaultDb, opts: { includeInactive?: boolean } = {}) {
  ensureMilkSchemeSchema(conn)
  const schemes = conn
    .prepare(`SELECT id, name, active, created_at AS createdAt, updated_at AS updatedAt FROM milk_schemes
              ${opts.includeInactive ? '' : 'WHERE active=1'} ORDER BY name, id`)
    .all() as { id: number; name: string; active: number; createdAt: number; updatedAt: number }[]
  const variants = conn
    .prepare('SELECT * FROM milk_scheme_variants ORDER BY scheme_id, sort_order, id')
    .all() as VariantRow[]
  const byScheme = new Map<number, ReturnType<typeof viewVariant>[]>()
  for (const v of variants) {
    const list = byScheme.get(v.scheme_id) ?? []
    list.push(viewVariant(v))
    byScheme.set(v.scheme_id, list)
  }
  const used = conn
    .prepare('SELECT milk_scheme_id AS id, COUNT(*) AS n FROM products WHERE milk_scheme_id IS NOT NULL GROUP BY milk_scheme_id')
    .all() as { id: number; n: number }[]
  const usedBy = new Map(used.map((u) => [u.id, u.n]))
  return schemes.map((s) => ({
    id: s.id,
    name: s.name,
    active: s.active === 1,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    variants: byScheme.get(s.id) ?? [],
    usedByProducts: usedBy.get(s.id) ?? 0,
  }))
}

export function getMilkScheme(id: number, conn: Database.Database = defaultDb) {
  return listMilkSchemes(conn, { includeInactive: true }).find((s) => s.id === id) ?? null
}

/** Ошибка валидации схемы молока — текст уходит в 400 как есть. */
export class MilkSchemeError extends Error {}

/**
 * Валидация бизнес-правил:
 *  • ровно один вариант по умолчанию (или ни одного, если ни один не помечен);
 *  • бесплатный вариант не уходит в чек (`isFree ⇒ !sendToReceipt`);
 *  • вариант, который уходит в чек, обязан ссылаться на товар Эвотор;
 *  • ссылки — только на существующие товары, дубликаты product_id запрещены;
 *  • имя схемы обязательно, лейбл варианта обязателен.
 */
export function validateMilkScheme(input: MilkSchemeInput, conn: Database.Database = defaultDb): void {
  const name = String(input.name ?? '').trim()
  if (!name) throw new MilkSchemeError('Название схемы обязательно')
  if (name.length > 80) throw new MilkSchemeError('Название схемы — не больше 80 символов')
  const variants = input.variants ?? []
  if (!variants.length) throw new MilkSchemeError('Добавьте хотя бы один вариант молока')

  const defaults = variants.filter((v) => v.isDefault && v.active !== false)
  if (defaults.length > 1) throw new MilkSchemeError('Вариант по умолчанию может быть только один')

  const seen = new Set<number>()
  for (const v of variants) {
    const label = String(v.label ?? '').trim()
    if (!label) throw new MilkSchemeError('У каждого варианта должно быть название')
    if (label.length > 60) throw new MilkSchemeError(`Название варианта «${label}» — не больше 60 символов`)
    if (v.isFree && v.sendToReceipt) {
      throw new MilkSchemeError(`«${label}»: бесплатный вариант не может передаваться в чек`)
    }
    if (v.sendToReceipt) {
      if (v.productId == null) throw new MilkSchemeError(`«${label}»: выберите товар Эвотор для платного варианта`)
      const exists = conn.prepare('SELECT 1 FROM products WHERE id=?').get(v.productId)
      if (!exists) throw new MilkSchemeError(`«${label}»: товар не найден`)
      if (seen.has(v.productId)) throw new MilkSchemeError(`«${label}»: этот товар уже привязан к другому варианту`)
      seen.add(v.productId)
    } else if (v.productId != null) {
      const exists = conn.prepare('SELECT 1 FROM products WHERE id=?').get(v.productId)
      if (!exists) throw new MilkSchemeError(`«${label}»: товар не найден`)
    }
  }
}

/** Создать или обновить схему (варианты заменяются целиком — как в схемах добавок). */
export function saveMilkScheme(input: MilkSchemeInput, conn: Database.Database = defaultDb) {
  ensureMilkSchemeSchema(conn)
  validateMilkScheme(input, conn)
  const now = Date.now()
  const id = conn.transaction(() => {
    let schemeId = input.id ?? 0
    if (schemeId) {
      const exists = conn.prepare('SELECT 1 FROM milk_schemes WHERE id=?').get(schemeId)
      if (!exists) throw new MilkSchemeError('Схема не найдена')
      conn.prepare('UPDATE milk_schemes SET name=?, active=?, updated_at=? WHERE id=?')
        .run(input.name.trim(), input.active ? 1 : 0, now, schemeId)
      conn.prepare('DELETE FROM milk_scheme_variants WHERE scheme_id=?').run(schemeId)
    } else {
      const r = conn.prepare('INSERT INTO milk_schemes(name,active,created_at,updated_at) VALUES(?,?,?,?)')
        .run(input.name.trim(), input.active ? 1 : 0, now, now)
      schemeId = Number(r.lastInsertRowid)
    }
    const ins = conn.prepare(`INSERT INTO milk_scheme_variants
      (scheme_id,product_id,label,is_default,is_free,send_to_receipt,sort_order,active)
      VALUES(?,?,?,?,?,?,?,?)`)
    input.variants.forEach((v, i) => {
      ins.run(
        schemeId,
        v.productId ?? null,
        String(v.label).trim(),
        v.isDefault ? 1 : 0,
        v.isFree ? 1 : 0,
        v.sendToReceipt ? 1 : 0,
        Number.isFinite(v.sortOrder) ? Number(v.sortOrder) : i,
        v.active === false ? 0 : 1,
      )
    })
    return schemeId
  })()
  return getMilkScheme(Number(id), conn)
}

/** Удаление запрещено, пока схема назначена товарам (иначе теряются назначения). */
export function deleteMilkScheme(id: number, conn: Database.Database = defaultDb) {
  ensureMilkSchemeSchema(conn)
  const used = (conn.prepare('SELECT COUNT(*) AS n FROM products WHERE milk_scheme_id=?').get(id) as { n: number }).n
  if (used > 0) {
    throw new MilkSchemeError(`Схема назначена ${used} товар(ам). Сначала снимите назначение или выключите схему`)
  }
  conn.prepare('DELETE FROM milk_scheme_variants WHERE scheme_id=?').run(id)
  conn.prepare('DELETE FROM milk_schemes WHERE id=?').run(id)
}

export type ResolvedMilkVariant = {
  id: number
  productId: number | null
  label: string
  evotorUuid: string | null
  isDefault: boolean
  isFree: boolean
  sendToReceipt: boolean
  sortOrder: number
  active: boolean
  /** Платный вариант без UUID на этой точке касса пробить не сможет. */
  available: boolean
  notReadyReason: 'no_evotor_uuid' | null
}

/**
 * Варианты молока для каталога кассы: только активные, UUID — по запрошенной точке.
 * Пустая схема/нет схемы → пустой массив (не ошибка).
 */
export function milkForProduct(
  conn: Database.Database,
  schemeId: number | null,
  uuidByProduct: Map<number, string>,
): ResolvedMilkVariant[] {
  if (schemeId == null) return []
  const rows = conn
    .prepare(`SELECT v.* FROM milk_scheme_variants v
              JOIN milk_schemes s ON s.id = v.scheme_id
              WHERE v.scheme_id=? AND v.active=1 AND s.active=1
              ORDER BY v.sort_order, v.id`)
    .all(schemeId) as VariantRow[]
  return rows.map((v) => {
    const uuid = v.product_id != null ? uuidByProduct.get(v.product_id) ?? null : null
    const needsUuid = v.send_to_receipt === 1
    const available = needsUuid ? uuid != null : true
    return {
      id: v.id,
      productId: v.product_id,
      label: v.label,
      evotorUuid: uuid,
      isDefault: v.is_default === 1,
      isFree: v.is_free === 1,
      sendToReceipt: v.send_to_receipt === 1,
      sortOrder: v.sort_order,
      active: true,
      available,
      notReadyReason: available ? null : 'no_evotor_uuid',
    }
  })
}
