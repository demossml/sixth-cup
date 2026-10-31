/**
 * Перенос молока из схем добавок в самостоятельные схемы молока.
 *
 * Исторически молоко хранилось внутри `modifier_schemes` (`group_key='milk'`).
 * С версии, где молоко — отдельная сущность, такие строки не должны участвовать
 * в каталоге добавок. Перенос идемпотентный: после успешной миграции строк с
 * `group_key='milk'` не остаётся, повторный вызов ничего не делает.
 *
 * Неоднозначные записи НЕ удаляются: они попадают в отчёт, чтобы владелец решил вручную.
 */
import type Database from 'better-sqlite3'
import { ensureAddonSchemeSchema, isLegacyMilkGroup } from './addonScheme'
import { ensureMilkSchemeSchema } from './milkScheme'

export type MilkMigrationReport = {
  /** Сколько вариантов перенесено в схемы молока. */
  migratedOptions: number
  /** Сколько схем молока создано (0 при повторном запуске). */
  schemesCreated: number
  /** Сколько товаров получили назначение схемы молока. */
  productsAssigned: number
  /** Строки, которые нельзя перенести автоматически — их не трогаем. */
  ambiguous: { source: string; id: number; schemeId: number | null; reason: string }[]
}

/** Имя схемы-наследника: стабильное, чтобы повторный запуск её находил, а не дублировал. */
const schemeName = (addonSchemeId: number, addonSchemeName: string) =>
  `Молоко: ${String(addonSchemeName || '').trim() || `схема добавок #${addonSchemeId}`}`

type OptionRow = {
  id: number
  schemeId: number
  kind: string
  productId: number | null
  modifierId: number | null
  name: string | null
  groupKey: string | null
  isDefault: number
  sortOrder: number
}

/**
 * Переносит варианты молока из `modifier_scheme_options` (и легаси `modifier_scheme_items`)
 * в `milk_schemes`, назначает схему товарам этой схемы добавок и удаляет перенесённые строки.
 */
export function migrateMilkFromAddonSchemes(conn: Database.Database): MilkMigrationReport {
  const report: MilkMigrationReport = { migratedOptions: 0, schemesCreated: 0, productsAssigned: 0, ambiguous: [] }
  ensureAddonSchemeSchema(conn)
  ensureMilkSchemeSchema(conn)

  const hasOptions = !!conn
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='modifier_scheme_options'")
    .get()
  const hasItems = !!conn
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='modifier_scheme_items'")
    .get()

  type Bucket = { options: OptionRow[]; schemeName: string }
  const buckets = new Map<number, Bucket>()

  const addOption = (row: OptionRow, schemeNameRaw: string) => {
    if (!isLegacyMilkGroup(row.groupKey)) return
    const bucket = buckets.get(row.schemeId) ?? { options: [], schemeName: schemeNameRaw }
    bucket.options.push(row)
    buckets.set(row.schemeId, bucket)
  }

  if (hasOptions) {
    const rows = conn
      .prepare(
        `SELECT o.id, o.scheme_id AS schemeId, o.kind, o.product_id AS productId, o.modifier_id AS modifierId,
                o.name, o.group_key AS groupKey, o.is_default AS isDefault, o.sort_order AS sortOrder,
                s.name AS schemeName
         FROM modifier_scheme_options o JOIN modifier_schemes s ON s.id = o.scheme_id
         ORDER BY o.scheme_id, o.sort_order, o.id`,
      )
      .all() as (OptionRow & { schemeName: string })[]
    for (const r of rows) addOption(r, r.schemeName)
  }

  // Легаси-таблица (схемы, созданные до появления options): молоко в ней — те же варианты.
  type ItemRow = {
    id: number
    schemeId: number
    productId: number | null
    modifierId: number | null
    nameOverride: string | null
    groupKey: string | null
    isDefault: number
    sortOrder: number
    schemeName: string
  }
  const legacyItems: ItemRow[] = hasItems
    ? (conn
        .prepare(
          `SELECT i.id, i.scheme_id AS schemeId, i.product_id AS productId, i.modifier_id AS modifierId,
                  i.name_override AS nameOverride, i.group_key AS groupKey, i.is_default AS isDefault,
                  i.sort_order AS sortOrder, s.name AS schemeName
           FROM modifier_scheme_items i JOIN modifier_schemes s ON s.id = i.scheme_id
           ORDER BY i.scheme_id, i.sort_order, i.id`,
        )
        .all() as ItemRow[])
    : []

  const modName = (modifierId: number | null): string | null => {
    if (modifierId == null) return null
    const row = conn.prepare('SELECT name, linked_product_id AS linkedProductId FROM modifiers WHERE id=?').get(modifierId) as
      | { name: string; linkedProductId: number | null }
      | undefined
    return row ? row.name : null
  }

  for (const it of legacyItems) {
    if (!isLegacyMilkGroup(it.groupKey)) continue
    const productId = it.productId ?? null
    const isZero = productId == null && it.modifierId == null
    addOption(
      {
        id: it.id,
        schemeId: it.schemeId,
        // zero-вариант без товара — бесплатное молоко, иначе платное
        kind: isZero ? 'zero' : 'product',
        productId,
        modifierId: it.modifierId,
        name: it.nameOverride ?? modName(it.modifierId),
        groupKey: it.groupKey,
        isDefault: it.isDefault,
        sortOrder: it.sortOrder,
      },
      it.schemeName,
    )
  }

  if (!buckets.size) return report

  conn.transaction(() => {
    for (const [addonSchemeId, bucket] of buckets) {
      const variants: { productId: number | null; label: string; isDefault: number; isFree: number; sendToReceipt: number }[] = []
      const movedIds: number[] = []

      for (const o of bucket.options) {
        let productId = o.productId
        let label = (o.name || '').trim()
        if (o.kind === 'modifier' && productId == null) {
          const row = conn.prepare('SELECT linked_product_id AS linkedProductId FROM modifiers WHERE id=?').get(o.modifierId) as
            | { linkedProductId: number | null }
            | undefined
          productId = row?.linkedProductId ?? null
        }
        if (!label && o.modifierId != null) label = modName(o.modifierId) ?? ''
        const isZero = o.kind === 'zero'
        if (isZero) {
          variants.push({
            productId: null,
            label: label || 'Обычное молоко',
            isDefault: o.isDefault ? 1 : 0,
            isFree: 1,
            sendToReceipt: 0,
          })
          movedIds.push(o.id)
          continue
        }
        if (productId == null) {
          report.ambiguous.push({
            source: hasOptions && bucket.options.some((x) => x.id === o.id) ? 'modifier_scheme_options' : 'modifier_scheme_items',
            id: o.id,
            schemeId: addonSchemeId,
            reason: 'платное молоко без товара Эвотор — нужна ручная привязка',
          })
          continue
        }
        const exists = conn.prepare('SELECT 1 FROM products WHERE id=?').get(productId)
        if (!exists) {
          report.ambiguous.push({
            source: 'modifier_scheme_options',
            id: o.id,
            schemeId: addonSchemeId,
            reason: `товар #${productId} не найден`,
          })
          continue
        }
        variants.push({ productId, label: label || `Молоко #${productId}`, isDefault: o.isDefault ? 1 : 0, isFree: 0, sendToReceipt: 1 })
        movedIds.push(o.id)
      }

      if (!variants.length) continue

      // Гарантируем одного «по умолчанию»: иначе схема молока невалидна.
      if (!variants.some((v) => v.isDefault)) {
        const free = variants.findIndex((v) => v.isFree === 1)
        variants[free >= 0 ? free : 0].isDefault = 1
      }

      const name = schemeName(addonSchemeId, bucket.schemeName)
      let milkSchemeId = (conn.prepare('SELECT id FROM milk_schemes WHERE name=?').get(name) as { id: number } | undefined)?.id
      if (!milkSchemeId) {
        const t = Date.now()
        const r = conn
          .prepare('INSERT INTO milk_schemes(name,active,created_at,updated_at) VALUES(?,?,?,?)')
          .run(name, 1, t, t)
        milkSchemeId = Number(r.lastInsertRowid)
        report.schemesCreated += 1
      }
      // Варианты перезаписываем целиком — повторный запуск не размножает строки.
      conn.prepare('DELETE FROM milk_scheme_variants WHERE scheme_id=?').run(milkSchemeId)
      const ins = conn.prepare(
        `INSERT INTO milk_scheme_variants(scheme_id,product_id,label,is_default,is_free,send_to_receipt,sort_order,active)
         VALUES(?,?,?,?,?,?,?,1)`,
      )
      variants.forEach((v, i) => ins.run(milkSchemeId, v.productId, v.label, v.isDefault, v.isFree, v.sendToReceipt, i))

      // Назначение: только там, где схема молока ещё не выбрана вручную.
      const assigned = conn
        .prepare('UPDATE products SET milk_scheme_id=? WHERE modifier_scheme_id=? AND milk_scheme_id IS NULL')
        .run(milkSchemeId, addonSchemeId)
      report.productsAssigned += Number(assigned.changes ?? 0)

      for (const id of movedIds) {
        if (hasOptions) conn.prepare('DELETE FROM modifier_scheme_options WHERE id=?').run(id)
        if (hasItems) conn.prepare('DELETE FROM modifier_scheme_items WHERE id=?').run(id)
      }
      report.migratedOptions += movedIds.length
    }
  })()

  return report
}

/**
 * Диагностика без изменений: что лежит в схемах добавок под ключом «молоко».
 * Используется отчётом миграции и тестами.
 */
export function inspectLegacyMilkOptions(conn: Database.Database) {
  ensureAddonSchemeSchema(conn)
  const hasOptions = !!conn
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='modifier_scheme_options'")
    .get()
  if (!hasOptions) return [] as { schemeId: number; schemeName: string; id: number; groupKey: string | null }[]
  const rows = conn
    .prepare(
      `SELECT o.id, o.scheme_id AS schemeId, o.group_key AS groupKey, s.name AS schemeName
       FROM modifier_scheme_options o JOIN modifier_schemes s ON s.id = o.scheme_id`,
    )
    .all() as { id: number; schemeId: number; groupKey: string | null; schemeName: string }[]
  return rows.filter((r) => isLegacyMilkGroup(r.groupKey))
}
