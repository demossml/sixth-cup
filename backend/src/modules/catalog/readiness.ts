/**
 * «Готовность кассы»: что касса не сможет продать и почему.
 *
 * Считается по нашей модели данных (молоко — отдельные таблицы, объёмы — схема-шаблон),
 * а не по контракту APK: это диагностика для админки, а не выдача кассе.
 *
 * Причины (те же коды, что в `configErrors` ответа `/configuration`):
 *  • `no_store_link` — у SKU нет строки в `product_store_links` для этой точки;
 *  • `no_evotor_uuid` — связь есть, но `evotor_uuid` пустой (нужна выгрузка);
 *  • `milk_scheme_empty` — схема молока назначена и активна, но выбрать нечего;
 *  • `choice_scheme_empty` — схема выбора (корица) назначена и активна, но активных вариантов меньше двух;
 *  • `unavailable` — позиция выключена.
 */
import type Database from 'better-sqlite3'
import { buildCatalogToppings, effectiveSchemeId, ensureAddonSchemeSchema, listAddonProductIds } from './addonScheme'
import { ensureMilkSchemeSchema } from './milkScheme'
import { choiceForProduct, ensureChoiceSchemeSchema } from './choiceScheme'
import { ensureVolumeSchemeSchema } from './volumeScheme'

export type ReadinessReason = 'no_store_link' | 'no_evotor_uuid' | 'milk_scheme_empty' | 'choice_scheme_empty' | 'unavailable'

export type NotReadyEntry = {
  kind: 'product' | 'volume' | 'milk' | 'choice' | 'addon' | 'volume_scheme'
  productId: number | null
  name: string
  reason: ReadinessReason
}

export type Readiness = {
  storeUuid: string | null
  cards: number
  readyCards: number
  notReady: NotReadyEntry[]
}

type SkuRow = {
  id: number
  name: string
  price: number
  available: number
  groupId: number | null
  isGroup: number
  variantLabel: string | null
  variantSort: number | null
  sizeValue: number | null
  sizeUnit: string | null
  modifierSchemeId: number | null
  milkSchemeId: number | null
  choiceSchemeId: number | null
  volumeSchemeId: number | null
  groupSchemeId: number | null
  seasonStartAt: number | null
  seasonEndAt: number | null
}

const SKU_SQL = `
  SELECT p.id, p.name, p.price, p.available, p.group_id AS groupId, COALESCE(p.is_group,0) AS isGroup,
         p.variant_label AS variantLabel, p.variant_sort AS variantSort,
         p.size_value AS sizeValue, p.size_unit AS sizeUnit,
         p.modifier_scheme_id AS modifierSchemeId, p.milk_scheme_id AS milkSchemeId, p.choice_scheme_id AS choiceSchemeId,
         p.volume_scheme_id AS volumeSchemeId,
         g.modifier_scheme_id AS groupSchemeId,
         p.season_start_at AS seasonStartAt, p.season_end_at AS seasonEndAt
  FROM products p LEFT JOIN product_groups g ON g.id = p.group_id
`

type Links = {
  /** productId → uuid (только непустые, включённые связи) */
  uuid: Map<number, string>
  /** productId → есть хоть какая-то связь (даже без uuid) */
  linked: Set<number>
}

function loadLinks(db: Database.Database, storeUuid: string | null): Links {
  const uuid = new Map<number, string>()
  const linked = new Set<number>()
  const rows = (
    storeUuid
      ? db
          .prepare(
            `SELECT product_id AS productId, evotor_uuid AS evotorUuid FROM product_store_links
             WHERE LOWER(store_uuid)=LOWER(?) AND COALESCE(enabled,1)=1`,
          )
          .all(storeUuid)
      : db
          .prepare(
            `SELECT product_id AS productId, evotor_uuid AS evotorUuid FROM product_store_links
             WHERE COALESCE(enabled,1)=1`,
          )
          .all()
  ) as { productId: number; evotorUuid: string | null }[]
  for (const r of rows) {
    const id = Number(r.productId)
    linked.add(id)
    const u = String(r.evotorUuid ?? '').trim()
    // Без storeUuid берём первый непустой uuid: «есть ли товар в Эвотор хоть где-то».
    if (u && !uuid.has(id)) uuid.set(id, u)
  }
  return { uuid, linked }
}

/** Причина, по которой SKU не продаётся на точке (null — продаётся). */
function skuReason(links: Links, storeUuid: string | null, id: number, available: number): ReadinessReason | null {
  if (Number(available) === 0) return 'unavailable'
  if (!links.uuid.get(id)) return links.linked.has(id) ? 'no_evotor_uuid' : 'no_store_link'
  void storeUuid
  return null
}

const inSeason = (row: SkuRow, nowMs: number) =>
  (row.seasonStartAt == null || row.seasonStartAt <= nowMs) && (row.seasonEndAt == null || row.seasonEndAt >= nowMs)

/** Объёмы карточки: SKU группы либо сам товар. */
function skuRowsFor(db: Database.Database, product: SkuRow, nowMs: number): SkuRow[] {
  if (product.groupId == null) return [product]
  const rows = (
    db
      .prepare(`${SKU_SQL} WHERE p.group_id=? AND COALESCE(p.is_group,0)=0 ORDER BY COALESCE(p.variant_sort,0), p.id`)
      .all(product.groupId) as SkuRow[]
  ).filter((r) => inSeason(r, nowMs))
  if (!rows.some((r) => r.id === product.id)) rows.unshift(product)
  return rows
}

export type CardReadiness = {
  productId: number
  name: string
  ready: boolean
  volumes: { productId: number; label: string; price: number; evotorUuid: string | null; ready: boolean; reason: ReadinessReason | null }[]
  milk: { schemeId: number | null; required: boolean; options: { name: string; isFree: boolean; evotorUuid: string | null; ready: boolean; reason: ReadinessReason | null }[] }
  addons: { schemeId: number | null; options: { name: string; group: string; price: number; evotorUuid: string | null; ready: boolean; reason: ReadinessReason | null }[] }
  volumeScheme: { schemeId: number | null; items: { label: string; price: number }[] }
  notReady: NotReadyEntry[]
}

/**
 * Диагностика одной карточки — то же, что увидит кассир после тапа.
 * `null`, если товар не существует, является группой или товаром-добавкой.
 */
export function cardReadiness(
  db: Database.Database,
  productId: number,
  storeUuid: string | null,
  nowMs = Date.now(),
): CardReadiness | null {
  ensureAddonSchemeSchema(db)
  ensureMilkSchemeSchema(db)
  ensureChoiceSchemeSchema(db)
  ensureVolumeSchemeSchema(db)

  const main = db.prepare(`${SKU_SQL} WHERE p.id=?`).get(productId) as SkuRow | undefined
  if (!main || Number(main.isGroup) === 1) return null
  if (!inSeason(main, nowMs)) return null
  if (listAddonProductIds(db).has(main.id)) return null

  const links = loadLinks(db, storeUuid)
  const skus = skuRowsFor(db, main, nowMs)
  const notReady: NotReadyEntry[] = []
  const seen = new Set<string>()
  const add = (e: NotReadyEntry) => {
    const key = `${e.kind}:${e.productId ?? e.name}:${e.reason}`
    if (seen.has(key)) return
    seen.add(key)
    notReady.push(e)
  }

  const volumes = skus.map((s) => {
    const uuid = links.uuid.get(s.id) ?? null
    const reason = skuReason(links, storeUuid, s.id, s.available)
    if (reason) {
      add({
        kind: skus.length > 1 ? 'volume' : 'product',
        productId: s.id,
        name: skus.length > 1 ? `${main.name} ${s.variantLabel ?? ''}`.trim() : s.name,
        reason,
      })
    }
    return {
      productId: s.id,
      label: s.variantLabel ?? (s.sizeValue != null ? `${s.sizeValue} ${s.sizeUnit ?? ''}`.trim() : ''),
      price: Number(s.price) || 0,
      evotorUuid: uuid,
      ready: reason === null,
      reason,
    }
  })

  // Молоко: у каждого объёма своё назначение (наследования от группы в модели нет).
  const milkOptions: CardReadiness['milk']['options'] = []
  const milkSeen = new Set<string>()
  let milkSchemeId: number | null = null
  let milkRequired = false
  for (const s of skus) {
    if (s.milkSchemeId == null) continue
    milkSchemeId = milkSchemeId ?? Number(s.milkSchemeId)
    const rows = db
      .prepare(
        `SELECT v.label, v.is_free, v.send_to_receipt, v.product_id,
                (SELECT COUNT(*) FROM milk_schemes ms WHERE ms.id=v.scheme_id AND ms.active=1) AS schemeActive
         FROM milk_scheme_variants v WHERE v.scheme_id=? AND v.active=1 ORDER BY v.sort_order, v.id`,
      )
      .all(Number(s.milkSchemeId)) as { label: string; is_free: number; send_to_receipt: number; product_id: number | null; schemeActive: number }[]
    if (!rows.length || rows[0].schemeActive === 0) {
      milkRequired = true
      add({ kind: 'milk', productId: s.id, name: `${main.name}: молоко`, reason: 'milk_scheme_empty' })
      continue
    }
    milkRequired = true
    for (const r of rows) {
      const uuid = r.product_id != null ? links.uuid.get(Number(r.product_id)) ?? null : null
      const needsUuid = r.send_to_receipt === 1
      const ready = !needsUuid || uuid != null
      if (!ready) add({ kind: 'milk', productId: r.product_id, name: `${main.name}: ${r.label}`, reason: links.linked.has(Number(r.product_id)) ? 'no_evotor_uuid' : 'no_store_link' })
      // У объёмов карточки обычно одна схема: в предпросмотре её показываем один раз.
      const key = `${r.label}:${r.is_free}:${uuid ?? ''}`
      if (!milkSeen.has(key)) {
        milkSeen.add(key)
        milkOptions.push({ name: r.label, isFree: r.is_free === 1, evotorUuid: uuid, ready, reason: ready ? null : uuid ? null : 'no_evotor_uuid' })
      }
    }
  }

  // Выбор без цены (корица): у каждого объёма своё назначение; ошибка настройки — не продаётся без выбора.
  for (const s of skus) {
    if (s.choiceSchemeId == null) continue
    const choice = choiceForProduct(db, Number(s.choiceSchemeId))
    if (choice && choice.options.length < 2) {
      add({ kind: 'choice', productId: s.id, name: `${main.name}: ${choice.title}`, reason: 'choice_scheme_empty' })
    }
  }

  // Добавки: схема SKU главнее схемы группы.
  const addonOptions: CardReadiness['addons']['options'] = []
  const addonSeen = new Set<string>()
  let addonSchemeId: number | null = null
  for (const s of skus) {
    const schemeId = effectiveSchemeId(db, s.modifierSchemeId, s.groupSchemeId)
    if (schemeId == null) continue
    addonSchemeId = addonSchemeId ?? schemeId
    for (const t of buildCatalogToppings(db, schemeId, links.uuid)) {
      const paid = !t.zeroOption && t.price > 0
      const ready = t.available
      if (!ready && paid) {
        add({
          kind: 'addon',
          productId: t.productId,
          name: `${main.name}: ${t.name}`,
          reason: t.productId != null && links.linked.has(Number(t.productId)) ? 'no_evotor_uuid' : 'no_store_link',
        })
      }
      const key = `${t.name}:${t.priceRub}:${t.evotorUuid ?? ''}`
      if (addonSeen.has(key)) continue
      addonSeen.add(key)
      addonOptions.push({
        name: t.name,
        group: t.groupKey,
        price: t.priceRub,
        evotorUuid: t.evotorUuid,
        ready,
        reason: ready ? null : t.notReadyReason === 'no_evotor_uuid' ? 'no_evotor_uuid' : 'no_store_link',
      })
    }
  }

  // Схема объёмов (шаблон): цены каждого объёма из карточки.
  const volumeScheme = { schemeId: main.volumeSchemeId != null ? Number(main.volumeSchemeId) : null, items: [] as { label: string; price: number }[] }
  if (main.volumeSchemeId != null) {
    const items = db
      .prepare(
        `SELECT i.id, i.label, COALESCE(pvp.price, ?) AS price
         FROM volume_scheme_items i
         JOIN volume_schemes s ON s.id=i.scheme_id AND s.active=1
         LEFT JOIN product_volume_prices pvp ON pvp.item_id=i.id AND pvp.product_id=?
         WHERE i.scheme_id=? AND i.active=1 ORDER BY i.sort_order, i.id`,
      )
      .all(Number(main.price) || 0, main.id, Number(main.volumeSchemeId)) as { id: number; label: string; price: number }[]
    if (!items.length) add({ kind: 'volume_scheme', productId: main.id, name: `${main.name}: объёмы`, reason: 'unavailable' })
    volumeScheme.items = items.map((i) => ({ label: i.label, price: Number(i.price) }))
  }

  return {
    productId: main.id,
    name: main.name,
    ready: notReady.length === 0,
    volumes,
    milk: { schemeId: milkSchemeId, required: milkRequired, options: milkOptions },
    addons: { schemeId: addonSchemeId, options: addonOptions },
    volumeScheme,
    notReady,
  }
}

/** Сводка по точке: сколько карточек касса сможет продать и что мешает остальным. */
export function catalogReadiness(db: Database.Database, storeUuid: string | null, nowMs = Date.now()): Readiness {
  const rows = db
    .prepare(`${SKU_SQL} WHERE COALESCE(p.is_group,0)=0 AND p.available=1 ORDER BY p.sort_order, p.id`)
    .all() as SkuRow[]
  const seen = new Set<string>()
  const notReady: NotReadyEntry[] = []
  let cards = 0
  let readyCards = 0
  for (const row of rows) {
    const card = cardReadiness(db, row.id, storeUuid, nowMs)
    if (!card) continue
    cards += 1
    if (card.ready) readyCards += 1
    for (const e of card.notReady) {
      const key = `${e.kind}:${e.productId ?? e.name}:${e.reason}`
      if (seen.has(key)) continue
      seen.add(key)
      notReady.push(e)
    }
  }
  return { storeUuid, cards, readyCards, notReady }
}
