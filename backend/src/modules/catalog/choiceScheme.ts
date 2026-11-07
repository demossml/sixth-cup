/**
 * Схема выбора без цены («с корицей» / «без корицы») — отдельная сущность.
 *
 * Модель:
 *  • `choice_schemes` — именованный набор вариантов выбора и заголовок для кассы (`title`: «Корица»);
 *  • `choice_scheme_options` — вариант: подпись, «по умолчанию», порядок, активность;
 *  • `products.choice_scheme_id` — назначение схемы товару (nullable: без схемы — норма).
 *
 * Выбор НЕ товар Эвотор: ни uuid, ни цены. На кассе это служебная метка, которая
 * печатается на чеке (PrintExtra) и не является фискальной позицией.
 * Пространство `id` опций выбора независимо от молока и добавок (они пересекаются).
 */
import type Database from 'better-sqlite3'
import { db as defaultDb } from '../../db'

export type ChoiceOptionInput = {
  id?: number
  label: string
  isDefault: boolean
  sortOrder: number
  active: boolean
}

export type ChoiceSchemeInput = {
  id?: number
  name: string
  title: string
  active: boolean
  options: ChoiceOptionInput[]
}

type OptionRow = {
  id: number
  scheme_id: number
  label: string
  is_default: number
  sort_order: number
  active: number
}

/** Максимальная длина подписи: ширина чековой ленты. */
export const CHOICE_LABEL_MAX = 24

export function ensureChoiceSchemeSchema(conn: Database.Database = defaultDb) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS choice_schemes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS choice_scheme_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scheme_id INTEGER NOT NULL REFERENCES choice_schemes(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_choice_options_scheme ON choice_scheme_options(scheme_id, sort_order, id);
  `)
  const cols = (conn.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('choice_scheme_id')) {
    conn.exec('ALTER TABLE products ADD COLUMN choice_scheme_id INTEGER REFERENCES choice_schemes(id)')
    conn.exec('CREATE INDEX IF NOT EXISTS idx_products_choice_scheme ON products(choice_scheme_id)')
  }
}

const viewOption = (o: OptionRow) => ({
  id: o.id,
  label: o.label,
  isDefault: o.is_default === 1,
  sortOrder: o.sort_order,
  active: o.active === 1,
})

export function listChoiceSchemes(conn: Database.Database = defaultDb, opts: { includeInactive?: boolean } = {}) {
  ensureChoiceSchemeSchema(conn)
  const schemes = conn
    .prepare(`SELECT id, name, title, active, created_at AS createdAt, updated_at AS updatedAt FROM choice_schemes
              ${opts.includeInactive ? '' : 'WHERE active=1'} ORDER BY name, id`)
    .all() as { id: number; name: string; title: string; active: number; createdAt: number; updatedAt: number }[]
  const options = conn
    .prepare('SELECT * FROM choice_scheme_options ORDER BY scheme_id, sort_order, id')
    .all() as OptionRow[]
  const byScheme = new Map<number, ReturnType<typeof viewOption>[]>()
  for (const o of options) {
    const list = byScheme.get(o.scheme_id) ?? []
    list.push(viewOption(o))
    byScheme.set(o.scheme_id, list)
  }
  const used = conn
    .prepare('SELECT choice_scheme_id AS id, COUNT(*) AS n FROM products WHERE choice_scheme_id IS NOT NULL GROUP BY choice_scheme_id')
    .all() as { id: number; n: number }[]
  const usedBy = new Map(used.map((u) => [u.id, u.n]))
  return schemes.map((s) => ({
    id: s.id,
    name: s.name,
    title: s.title,
    active: s.active === 1,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    options: byScheme.get(s.id) ?? [],
    usedByProducts: usedBy.get(s.id) ?? 0,
  }))
}

export function getChoiceScheme(id: number, conn: Database.Database = defaultDb) {
  return listChoiceSchemes(conn, { includeInactive: true }).find((s) => s.id === id) ?? null
}

/** Ошибка валидации схемы выбора — текст уходит в 400 как есть. */
export class ChoiceSchemeError extends Error {}

/**
 * Правила:
 *  • имя и заголовок для кассы обязательны;
 *  • минимум два активных варианта (выбор из одного не выбор);
 *  • подписи уникальны (без учёта регистра) и не длиннее ширины ленты;
 *  • «по умолчанию» — не более одного активного варианта.
 */
export function validateChoiceScheme(input: ChoiceSchemeInput): void {
  const name = String(input.name ?? '').trim()
  if (!name) throw new ChoiceSchemeError('Название схемы обязательно')
  if (name.length > 80) throw new ChoiceSchemeError('Название схемы — не больше 80 символов')
  const title = String(input.title ?? '').trim()
  if (!title) throw new ChoiceSchemeError('Заголовок на кассе обязателен (например, «Корица»)')
  if (title.length > 24) throw new ChoiceSchemeError('Заголовок на кассе — не больше 24 символов')
  const options = input.options ?? []
  const labels = new Set<string>()
  for (const o of options) {
    const label = String(o.label ?? '').trim()
    if (!label) throw new ChoiceSchemeError('У каждого варианта должна быть подпись')
    if (label.length > CHOICE_LABEL_MAX) {
      throw new ChoiceSchemeError(`Подпись «${label}» — не больше ${CHOICE_LABEL_MAX} символов`)
    }
    const key = label.toLowerCase()
    if (labels.has(key)) throw new ChoiceSchemeError(`Подпись «${label}» повторяется`)
    labels.add(key)
  }
  const active = options.filter((o) => o.active !== false)
  if (active.length < 2) throw new ChoiceSchemeError('Нужно минимум два активных варианта')
  if (active.filter((o) => o.isDefault).length > 1) {
    throw new ChoiceSchemeError('Вариант по умолчанию может быть только один')
  }
}

/** Создать или обновить схему (варианты заменяются целиком — как у молока). */
export function saveChoiceScheme(input: ChoiceSchemeInput, conn: Database.Database = defaultDb) {
  ensureChoiceSchemeSchema(conn)
  validateChoiceScheme(input)
  const now = Date.now()
  const id = conn.transaction(() => {
    let schemeId = input.id ?? 0
    if (schemeId) {
      const exists = conn.prepare('SELECT 1 FROM choice_schemes WHERE id=?').get(schemeId)
      if (!exists) throw new ChoiceSchemeError('Схема не найдена')
      conn
        .prepare('UPDATE choice_schemes SET name=?, title=?, active=?, updated_at=? WHERE id=?')
        .run(input.name.trim(), input.title.trim(), input.active ? 1 : 0, now, schemeId)
      conn.prepare('DELETE FROM choice_scheme_options WHERE scheme_id=?').run(schemeId)
    } else {
      const r = conn
        .prepare('INSERT INTO choice_schemes(name,title,active,created_at,updated_at) VALUES(?,?,?,?,?)')
        .run(input.name.trim(), input.title.trim(), input.active ? 1 : 0, now, now)
      schemeId = Number(r.lastInsertRowid)
    }
    const ins = conn.prepare(
      'INSERT INTO choice_scheme_options(scheme_id,label,is_default,sort_order,active) VALUES(?,?,?,?,?)',
    )
    input.options.forEach((o, i) => {
      ins.run(
        schemeId,
        String(o.label).trim(),
        o.isDefault && o.active !== false ? 1 : 0,
        Number.isFinite(o.sortOrder) ? Number(o.sortOrder) : i,
        o.active === false ? 0 : 1,
      )
    })
    return schemeId
  })()
  return getChoiceScheme(Number(id), conn)
}

/** Удаление запрещено, пока схема назначена товарам (иначе теряются назначения). */
export function deleteChoiceScheme(id: number, conn: Database.Database = defaultDb) {
  ensureChoiceSchemeSchema(conn)
  const used = (conn.prepare('SELECT COUNT(*) AS n FROM products WHERE choice_scheme_id=?').get(id) as { n: number }).n
  if (used > 0) {
    throw new ChoiceSchemeError(`Схема назначена ${used} товар(ам). Сначала снимите назначение или выключите схему`)
  }
  conn.prepare('DELETE FROM choice_scheme_options WHERE scheme_id=?').run(id)
  conn.prepare('DELETE FROM choice_schemes WHERE id=?').run(id)
}

export type ResolvedChoiceOption = {
  id: number
  label: string
  isDefault: boolean
  sortOrder: number
}

export type ResolvedChoice = {
  schemeId: number
  title: string
  options: ResolvedChoiceOption[]
}

/**
 * Выбор для кассы: только активная схема и активные варианты.
 * `null` — схемы нет / она выключена (блок на кассе не показывается).
 * Схема активна, но активных вариантов < 2 — отдаём `options` как есть: решает вызывающий (это ошибка настройки).
 */
export function choiceForProduct(conn: Database.Database, schemeId: number | null): ResolvedChoice | null {
  if (schemeId == null) return null
  const scheme = conn
    .prepare('SELECT id, title FROM choice_schemes WHERE id=? AND active=1')
    .get(schemeId) as { id: number; title: string } | undefined
  if (!scheme) return null
  const rows = conn
    .prepare('SELECT * FROM choice_scheme_options WHERE scheme_id=? AND active=1 ORDER BY sort_order, id')
    .all(schemeId) as OptionRow[]
  return {
    schemeId: scheme.id,
    title: scheme.title,
    options: rows.map((o) => ({ id: o.id, label: o.label, isDefault: o.is_default === 1, sortOrder: o.sort_order })),
  }
}

export type ChoiceAssignPreviewItem = { productId: number; name: string; groupId: number | null; current: number | null }

/**
 * Назначить (или снять, `schemeId=null`) схему выбора группам и/или товарам.
 * Для группы затрагиваются все её SKU (не сама строка-группа). `dryRun` ничего не пишет.
 */
export function applyChoiceScheme(
  conn: Database.Database,
  schemeId: number | null,
  target: { groupIds?: number[]; productIds?: number[] },
  dryRun: boolean,
): { items: ChoiceAssignPreviewItem[]; changed: number } {
  ensureChoiceSchemeSchema(conn)
  if (schemeId != null) {
    const exists = conn.prepare('SELECT 1 FROM choice_schemes WHERE id=?').get(schemeId)
    if (!exists) throw new ChoiceSchemeError('Схема не найдена')
  }
  const ids = new Set<number>()
  for (const g of target.groupIds ?? []) {
    const rows = conn
      .prepare('SELECT id FROM products WHERE group_id=? AND COALESCE(is_group,0)=0')
      .all(g) as { id: number }[]
    for (const r of rows) ids.add(Number(r.id))
  }
  for (const p of target.productIds ?? []) ids.add(Number(p))
  const items: ChoiceAssignPreviewItem[] = []
  for (const id of [...ids].sort((a, b) => a - b)) {
    const row = conn
      .prepare('SELECT id, name, group_id AS groupId, choice_scheme_id AS current, COALESCE(is_group,0) AS isGroup FROM products WHERE id=?')
      .get(id) as { id: number; name: string; groupId: number | null; current: number | null; isGroup: number } | undefined
    if (!row || Number(row.isGroup) === 1) continue
    items.push({ productId: row.id, name: row.name, groupId: row.groupId, current: row.current ?? null })
  }
  const changing = items.filter((i) => i.current !== schemeId)
  if (!dryRun && changing.length) {
    const upd = conn.prepare('UPDATE products SET choice_scheme_id=? WHERE id=?')
    conn.transaction(() => {
      for (const i of changing) upd.run(schemeId, i.productId)
    })()
  }
  return { items, changed: changing.length }
}
