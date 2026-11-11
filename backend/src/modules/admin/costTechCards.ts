/**
 * F3–F7: себестоимость v2 — техкарты на складе.
 *
 * Правила расчёта живут в `costCalc.ts` (чистые функции + тесты), здесь только БД и HTTP.
 * Старый модуль `cost.ts` не тронут: его эндпоинты продолжают работать, чтобы не было
 * регресса у ПВА/каталога и текущего UI.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import {
  cardInsights,
  cardTotals,
  costPerUnitKop,
  findCycle,
  foodCostPct,
  marginKop,
  priceWindowStart,
  retailFromMarkup,
  weightedCostKop,
  type LineInput,
  type PricePoint,
  type PurchasePoint,
  type Unit,
} from './costCalc'

type Role = 'owner' | 'manager' | 'viewer'
function roleOf(c: { get: (k: string) => unknown }): Role {
  return (c.get('adminRole' as never) as Role) || 'owner'
}
function requireWrite(c: { get: (k: string) => unknown }) {
  if (roleOf(c) === 'viewer') throw bad('Read-only admin token', 403)
}

const now = () => Date.now()
const kop = (rub: number | null | undefined) => (rub == null ? null : Math.round(Number(rub) * 100))
const rub = (k: number | null | undefined) => (k == null || !Number.isFinite(k) ? null : Math.round(k) / 100)

/* ─────────────────────────── цены ─────────────────────────── */

type ItemRow = {
  id: number
  name: string
  unit: Unit
  kind: string
  active: number
  weightPerPcKg: number | null
  densityKgL: number | null
  manualCostKop: number | null
  notes: string | null
}

function itemById(id: number): ItemRow | undefined {
  return db
    .prepare(
      `SELECT id, name, unit, kind, active, weight_per_pc_kg AS weightPerPcKg,
              density_kg_l AS densityKgL, manual_cost_kop AS manualCostKop, notes
         FROM stock_items WHERE id=?`,
    )
    .get(id) as ItemRow | undefined
}

function lastInventoryAt(): number | null {
  const row = db
    .prepare(
      `SELECT MAX(COALESCE(posted_at, created_at)) AS at FROM inventory_docs WHERE status <> 'draft'`,
    )
    .get() as { at: number | null } | undefined
  return row?.at ?? null
}

/**
 * Средневзвешенная цена всех активных позиций: одно окно на весь справочник.
 * Возвращает карту «позиция → копейки за её базовую единицу».
 */
export function unitCostMap(at = now(), windowDays = 90): Map<number, { costKop: number | null; source: string }> {
  const since = priceWindowStart(at, lastInventoryAt(), windowDays)

  const purchases = db
    .prepare(
      `SELECT l.stock_item_id AS itemId, i.posted_at AS at, l.qty, l.unit_cost_kop AS unitCostKop
         FROM purchase_invoice_lines l
         JOIN purchase_invoices i ON i.id = l.invoice_id
        WHERE i.status = 'posted' AND i.posted_at >= ?`,
    )
    .all(since) as { itemId: number; at: number; qty: number; unitCostKop: number }[]

  const history = db
    .prepare(`SELECT stock_item_id AS itemId, at, cost_kop AS costKop, source FROM stock_item_cost_history`)
    .all() as { itemId: number; at: number; costKop: number; source: 'invoice' | 'inventory' | 'manual' | 'backfill' }[]

  const items = db
    .prepare(`SELECT id, manual_cost_kop AS manualCostKop FROM stock_items WHERE active=1`)
    .all() as { id: number; manualCostKop: number | null }[]

  const byItem = new Map<number, PurchasePoint[]>()
  for (const p of purchases) {
    if (!byItem.has(p.itemId)) byItem.set(p.itemId, [])
    byItem.get(p.itemId)!.push({ at: p.at, qty: p.qty, unitCostKop: p.unitCostKop })
  }
  const histByItem = new Map<number, PricePoint[]>()
  for (const h of history) {
    if (!histByItem.has(h.itemId)) histByItem.set(h.itemId, [])
    histByItem.get(h.itemId)!.push({ at: h.at, costKop: h.costKop, source: h.source })
  }

  const out = new Map<number, { costKop: number | null; source: string }>()
  for (const it of items) {
    out.set(
      it.id,
      weightedCostKop(byItem.get(it.id) ?? [], {
        since,
        history: histByItem.get(it.id) ?? [],
        manualKop: it.manualCostKop,
      }),
    )
  }
  return out
}

/* ─────────────────────── карты: чтение и расчёт ─────────────────────── */

type CardRow = {
  id: number
  name: string
  kind: 'dish' | 'semi' | 'modifier'
  outputQty: number
  outputUnit: Unit
  productId: number | null
  categoryId: number | null
  methodText: string | null
  status: 'draft' | 'active' | 'archived'
  writeOffMode: 'ingredients' | 'semi' | 'semi_then_ingredients' | 'none'
  retailPriceKop: number | null
  markupPct: number
  createdAt: number
  updatedAt: number
}

function cardRow(id: number): CardRow | undefined {
  return db
    .prepare(
      `SELECT id, name, kind, output_qty AS outputQty, output_unit AS outputUnit, product_id AS productId,
              category_id AS categoryId, method_text AS methodText, status,
              write_off_mode AS writeOffMode, retail_price_kop AS retailPriceKop, markup_pct AS markupPct,
              created_at AS createdAt, updated_at AS updatedAt
         FROM tech_cards WHERE id=?`,
    )
    .get(id) as CardRow | undefined
}

type VersionRow = { id: number; cardId: number; validFrom: number; note: string | null; createdAt: number }
type LineRow = {
  id: number
  versionId: number
  sortOrder: number
  stockItemId: number | null
  childCardId: number | null
  qtyBrutto: number
  lossColdPct: number
  lossHotPct: number
  qtyNetto: number | null
  qtyYield: number | null
  lineRole: 'base' | 'optional'
}

function versionsOf(cardId: number): VersionRow[] {
  return db
    .prepare(
      `SELECT id, card_id AS cardId, valid_from AS validFrom, note, created_at AS createdAt
         FROM tech_card_versions WHERE card_id=? ORDER BY valid_from DESC, id DESC`,
    )
    .all(cardId) as VersionRow[]
}

/** Активная версия на дату: последняя с `valid_from <= at`. */
function activeVersion(cardId: number, at = now()): VersionRow | undefined {
  return db
    .prepare(
      `SELECT id, card_id AS cardId, valid_from AS validFrom, note, created_at AS createdAt
         FROM tech_card_versions WHERE card_id=? AND valid_from<=?
         ORDER BY valid_from DESC, id DESC LIMIT 1`,
    )
    .get(cardId, at) as VersionRow | undefined
}

function linesOf(versionId: number): LineRow[] {
  return db
    .prepare(
      `SELECT id, version_id AS versionId, sort_order AS sortOrder, stock_item_id AS stockItemId,
              child_card_id AS childCardId, qty_brutto AS qtyBrutto,
              loss_cold_pct AS lossColdPct, loss_hot_pct AS lossHotPct,
              qty_netto AS qtyNetto, qty_yield AS qtyYield, line_role AS lineRole
         FROM tech_card_lines WHERE version_id=? ORDER BY sort_order, id`,
    )
    .all(versionId) as LineRow[]
}

/**
 * Полная себестоимость карты-заготовки (не единицы): строка блюда берёт её и делит
 * на норму закладки заготовки. Циклы отсекаются `seen`, результаты — в `memo`.
 */
function totalCostOf(
  cardId: number,
  costs: Map<number, { costKop: number | null; source: string }>,
  memo: Map<number, number | null>,
  seen: Set<number>,
): number | null {
  if (memo.has(cardId)) return memo.get(cardId)!
  if (seen.has(cardId)) return null // цикл: цены нет, отдельная проверка цикла покажет ошибку
  const card = cardRow(cardId)
  if (!card) return null
  seen.add(cardId)
  const version = activeVersion(cardId)
  const total = version ? computeTotals(linesOf(version.id), costs, memo, seen) : { costKop: null }
  seen.delete(cardId)
  memo.set(cardId, total.costKop)
  return total.costKop
}

function computeTotals(
  lines: LineRow[],
  costs: Map<number, { costKop: number | null; source: string }>,
  memo: Map<number, number | null>,
  seen: Set<number>,
): { costKop: number | null; optionalKop: number | null; missing: boolean; inputs: LineInput[] } {
  const inputs: LineInput[] = lines.map((l) => {
    if (l.childCardId) {
      const child = cardRow(l.childCardId)
      return {
        qtyBrutto: l.qtyBrutto,
        lossColdPct: l.lossColdPct,
        lossHotPct: l.lossHotPct,
        qtyNetto: l.qtyNetto,
        qtyYield: l.qtyYield,
        lineRole: l.lineRole,
        child: child
          ? {
              // Стоимость ВСЕЙ карты-заготовки: строка «150 мл» возьмёт долю 150/900.
              costKop: totalCostOf(l.childCardId, costs, memo, seen),
              outputQty: child.outputQty,
              outputUnit: child.outputUnit,
            }
          : null,
      }
    }
    const item = l.stockItemId ? itemById(l.stockItemId) : undefined
    return {
      qtyBrutto: l.qtyBrutto,
      lossColdPct: l.lossColdPct,
      lossHotPct: l.lossHotPct,
      qtyNetto: l.qtyNetto,
      qtyYield: l.qtyYield,
      lineRole: l.lineRole,
      unitCostKop: l.stockItemId ? costs.get(l.stockItemId)?.costKop ?? null : null,
      fromUnit: item?.unit,
      toUnit: item?.unit,
      meta: item ? { unit: item.unit, weightPerPcKg: item.weightPerPcKg, densityKgL: item.densityKgL } : undefined,
    }
  })
  const totals = cardTotals(inputs)
  return { costKop: totals.costKop, optionalKop: totals.optionalKop, missing: totals.missing, inputs }
}

export function serializeCard(id: number, opts: { versionId?: number } = {}) {
  const card = cardRow(id)
  if (!card) return null
  const costs = unitCostMap()
  const memo = new Map<number, number | null>()
  const versions = versionsOf(id)
  const version = opts.versionId ? versions.find((v) => v.id === opts.versionId) : activeVersion(id)
  const lines = version ? linesOf(version.id) : []
  const totals = computeTotals(lines, costs, memo, new Set([id]))

  const costPerUnit = costPerUnitKop(totals.costKop, card.outputQty)
  const retail = card.retailPriceKop ?? retailFromMarkup(costPerUnit, card.markupPct)
  const fc = foodCostPct(costPerUnit, retail)

  return {
    id: card.id,
    name: card.name,
    kind: card.kind,
    outputQty: card.outputQty,
    outputUnit: card.outputUnit,
    productId: card.productId,
    status: card.status,
    writeOffMode: card.writeOffMode,
    retailPriceRub: rub(card.retailPriceKop),
    markupPct: card.markupPct,
    methodText: card.methodText,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    version: version ? { id: version.id, validFrom: version.validFrom, note: version.note } : null,
    versions: versions.map((v) => ({ id: v.id, validFrom: v.validFrom, note: v.note, active: v.id === version?.id })),
    costRub: rub(totals.costKop),
    costPerUnitRub: rub(costPerUnit),
    optionalRub: rub(totals.optionalKop ?? null),
    retailRub: rub(retail),
    retailCalcRub: rub(retailFromMarkup(costPerUnit, card.markupPct)),
    foodCostPct: fc,
    marginRub: rub(marginKop(costPerUnit, retail)),
    missingPrices: totals.missing,
    insights: cardInsights({
      costKop: costPerUnit,
      retailKop: retail,
      missingPrices: totals.missing,
      foodCostPct: fc,
    }),
    lines: lines.map((l, i) => {
      const input = totals.inputs[i]!
      const resolved = cardTotals([input]).lines[0]!
      const item = l.stockItemId ? itemById(l.stockItemId) : undefined
      const child = l.childCardId ? cardRow(l.childCardId) : undefined
      return {
        id: l.id,
        stockItemId: l.stockItemId,
        stockItemName: item?.name ?? null,
        itemUnit: item?.unit ?? null,
        childCardId: l.childCardId,
        childCardName: child?.name ?? null,
        qtyBrutto: l.qtyBrutto,
        lossColdPct: l.lossColdPct,
        lossHotPct: l.lossHotPct,
        qtyNetto: resolved.yield.netto,
        qtyYield: resolved.yield.yieldQty,
        computed: resolved.yield.computed,
        warnings: resolved.yield.warnings,
        lineRole: l.lineRole,
        unitCostRub: l.stockItemId ? rub(costs.get(l.stockItemId)?.costKop ?? null) : null,
        costSource: l.stockItemId ? costs.get(l.stockItemId)?.source ?? 'none' : 'card',
        lineCostRub: rub(resolved.costKop),
      }
    }),
  }
}

/* ─────────────────────────── схемы тела ─────────────────────────── */

const lineZ = z.object({
  stockItemId: z.number().int().positive().nullable().optional(),
  childCardId: z.number().int().positive().nullable().optional(),
  qtyBrutto: z.number().positive(),
  lossColdPct: z.number().min(-500).max(100).optional(),
  lossHotPct: z.number().min(-500).max(100).optional(),
  qtyNetto: z.number().nonnegative().nullable().optional(),
  qtyYield: z.number().nonnegative().nullable().optional(),
  lineRole: z.enum(['base', 'optional']).optional(),
})

const cardZ = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['dish', 'semi', 'modifier']).optional(),
  outputQty: z.number().positive().optional(),
  outputUnit: z.enum(['kg', 'l', 'pcs', 'g', 'ml']).optional(),
  productId: z.number().int().positive().nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  methodText: z.string().max(8000).nullable().optional(),
  writeOffMode: z.enum(['ingredients', 'semi', 'semi_then_ingredients', 'none']).optional(),
  retailPriceRub: z.number().nonnegative().nullable().optional(),
  markupPct: z.number().min(0).max(10000).optional(),
  lines: z.array(lineZ).optional(),
})

function replaceLines(versionId: number, lines: z.infer<typeof lineZ>[]) {
  db.prepare(`DELETE FROM tech_card_lines WHERE version_id=?`).run(versionId)
  const ins = db.prepare(
    `INSERT INTO tech_card_lines(version_id, sort_order, stock_item_id, child_card_id, qty_brutto,
                                 loss_cold_pct, loss_hot_pct, qty_netto, qty_yield, line_role)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  )
  lines.forEach((l, i) => {
    if (!l.stockItemId && !l.childCardId) throw bad('Строка без ингредиента и без заготовки', 400)
    if (l.stockItemId && l.childCardId) throw bad('Строка не может быть сразу ингредиентом и заготовкой', 400)
    ins.run(
      versionId,
      i,
      l.stockItemId ?? null,
      l.childCardId ?? null,
      l.qtyBrutto,
      l.lossColdPct ?? 0,
      l.lossHotPct ?? 0,
      l.qtyNetto ?? null,
      l.qtyYield ?? null,
      l.lineRole ?? 'base',
    )
  })
}

/** Граф «карта → вложенные карты» для проверки циклов. */
function cardGraph(): Record<number, number[]> {
  const rows = db
    .prepare(
      `SELECT DISTINCT v.card_id AS cardId, l.child_card_id AS childId
         FROM tech_card_lines l JOIN tech_card_versions v ON v.id = l.version_id
        WHERE l.child_card_id IS NOT NULL`,
    )
    .all() as { cardId: number; childId: number }[]
  const g: Record<number, number[]> = {}
  for (const r of rows) {
    g[r.cardId] = g[r.cardId] ?? []
    g[r.cardId]!.push(r.childId)
  }
  return g
}

/** Проекция карты на склад: нормы списания + режим + себестоимость товара для кассы. */
export function projectCard(cardId: number): { norms: number; costKop: number | null } {
  const card = cardRow(cardId)
  if (!card) return { norms: 0, costKop: null }
  const version = activeVersion(cardId)
  if (!version) return { norms: 0, costKop: null }
  const lines = linesOf(version.id)
  const totals = computeTotals(lines, unitCostMap(), new Map(), new Set([cardId]))
  const costPerUnit = costPerUnitKop(totals.costKop, card.outputQty)

  const direct = lines.filter((l) => l.stockItemId)
  db.transaction(() => {
    if (card.productId) {
      db.prepare(`DELETE FROM product_stock_norms WHERE product_id=?`).run(card.productId)
      const ins = db.prepare(`INSERT OR REPLACE INTO product_stock_norms(product_id, stock_item_id, qty) VALUES(?,?,?)`)
      for (const l of direct) ins.run(card.productId, l.stockItemId!, l.qtyBrutto)
      const mode =
        card.writeOffMode === 'ingredients' ? 'raw' : card.writeOffMode === 'none' ? 'none' : 'piece'
      db.prepare(
        `INSERT INTO product_recipe_modes(product_id, mode, updated_at) VALUES(?,?,?)
         ON CONFLICT(product_id) DO UPDATE SET mode=excluded.mode, updated_at=excluded.updated_at`,
      ).run(card.productId, mode, now())
      if (costPerUnit != null) {
        db.prepare(`UPDATE products SET cost_price_kopecks=?, updated_at=? WHERE id=?`).run(
          Math.round(costPerUnit),
          now(),
          card.productId,
        )
      }
    }
  })()
  return { norms: direct.length, costKop: costPerUnit }
}

/* ─────────────────────────── маршруты ─────────────────────────── */

export const adminCostTechCards = new Hono()

  .get('/cost/tech-cards', (c) => {
    const q = (c.req.query('q') || '').trim().toLowerCase()
    const kind = c.req.query('kind')
    const onlyProblems = c.req.query('problems') === '1'
    const rows = db
      .prepare(
        `SELECT id, name, kind, status, product_id AS productId FROM tech_cards
          ${kind ? 'WHERE kind = ?' : ''} ORDER BY name COLLATE NOCASE`,
      )
      .all(...(kind ? [kind] : [])) as { id: number; name: string; kind: string; status: string; productId: number | null }[]

    const cards = rows
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .map((r) => serializeCard(r.id))
      .filter(Boolean)
    const filtered = onlyProblems ? cards.filter((c) => c!.insights.length > 0) : cards
    return c.json({
      cards: filtered.map((c) => ({
        id: c!.id,
        name: c!.name,
        kind: c!.kind,
        status: c!.status,
        productId: c!.productId,
        outputQty: c!.outputQty,
        outputUnit: c!.outputUnit,
        costPerUnitRub: c!.costPerUnitRub,
        retailRub: c!.retailRub,
        foodCostPct: c!.foodCostPct,
        marginRub: c!.marginRub,
        linesCount: c!.lines.length,
        version: c!.version ? { id: c!.version.id, validFrom: c!.version.validFrom } : null,
        insights: c!.insights,
      })),
      totals: {
        cards: filtered.length,
        problems: cards.filter((c) => c!.insights.length > 0).length,
      },
    })
  })

  .get('/cost/tech-cards/:id', (c) => {
    const id = Number(c.req.param('id'))
    const versionId = c.req.query('versionId') ? Number(c.req.query('versionId')) : undefined
    const card = serializeCard(id, { versionId })
    if (!card) throw bad('Техкарта не найдена', 404)
    return c.json({ card })
  })

  .post('/cost/tech-cards', zValidator('json', cardZ), (c) => {
    requireWrite(c)
    const p = c.req.valid('json')
    const t = now()
    const id = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO tech_cards(name, kind, output_qty, output_unit, product_id, category_id, method_text,
                                  status, write_off_mode, retail_price_kop, markup_pct, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,'draft',?,?,?,?,?)`,
        )
        .run(
          p.name,
          p.kind ?? 'dish',
          p.outputQty ?? 1,
          p.outputUnit ?? 'pcs',
          p.productId ?? null,
          p.categoryId ?? null,
          p.methodText ?? null,
          p.writeOffMode ?? 'ingredients',
          kop(p.retailPriceRub),
          p.markupPct ?? 300,
          t,
          t,
        )
      const cardId = Number(info.lastInsertRowid)
      const v = db
        .prepare(`INSERT INTO tech_card_versions(card_id, valid_from, note, created_at) VALUES(?,?,?,?)`)
        .run(cardId, t, 'создание', t)
      replaceLines(Number(v.lastInsertRowid), p.lines ?? [])
      return cardId
    })()
    return c.json({ ok: true, card: serializeCard(id) })
  })

  .put('/cost/tech-cards/:id', zValidator('json', cardZ.partial()), (c) => {
    requireWrite(c)
    const id = Number(c.req.param('id'))
    const cur = cardRow(id)
    if (!cur) throw bad('Техкарта не найдена', 404)
    const p = c.req.valid('json')
    const t = now()
    db.transaction(() => {
      db.prepare(
        `UPDATE tech_cards SET name=?, kind=?, output_qty=?, output_unit=?, product_id=?, category_id=?,
                               method_text=?, write_off_mode=?, retail_price_kop=?, markup_pct=?, updated_at=?
          WHERE id=?`,
      ).run(
        p.name ?? cur.name,
        p.kind ?? cur.kind,
        p.outputQty ?? cur.outputQty,
        p.outputUnit ?? cur.outputUnit,
        p.productId !== undefined ? p.productId : cur.productId,
        p.categoryId !== undefined ? p.categoryId : cur.categoryId,
        p.methodText !== undefined ? p.methodText : cur.methodText,
        p.writeOffMode ?? cur.writeOffMode,
        p.retailPriceRub !== undefined ? kop(p.retailPriceRub) : cur.retailPriceKop,
        p.markupPct ?? cur.markupPct,
        t,
        id,
      )
      if (p.lines) {
        const wantVersion = c.req.query('versionId')
        const v = wantVersion
          ? versionsOf(id).find((x) => x.id === Number(wantVersion)) ?? null
          : activeVersion(id)
        if (!v) throw bad('У карты нет версии', 400)
        replaceLines(v.id, p.lines)
        db.prepare(`UPDATE tech_card_versions SET note=? WHERE id=?`).run(v.note ?? 'правка', v.id)
      }
      // Циклы проверяем после записи: граф должен быть актуальным.
      const cycle = findCycle(cardGraph(), id)
      if (cycle) throw bad(`Заготовка входит сама в себя: ${cycle.join(' → ')}`, 400)
    })()
    return c.json({ ok: true, card: serializeCard(id) })
  })

  .delete('/cost/tech-cards/:id', (c) => {
    requireWrite(c)
    const id = Number(c.req.param('id'))
    const used = db
      .prepare(
        `SELECT DISTINCT v.card_id AS cardId FROM tech_card_lines l JOIN tech_card_versions v ON v.id=l.version_id
          WHERE l.child_card_id=?`,
      )
      .all(id) as { cardId: number }[]
    if (used.length) {
      const names = used.map((u) => cardRow(u.cardId)?.name ?? `#${u.cardId}`)
      throw bad(`Нельзя удалить: заготовка входит в карты: ${names.join(', ')}`, 409)
    }
    const card = cardRow(id)
    const r = db.prepare(`DELETE FROM tech_cards WHERE id=?`).run(id)
    if (!r.changes) throw bad('Техкарта не найдена', 404)
    if (card?.productId) db.prepare(`DELETE FROM product_stock_norms WHERE product_id=?`).run(card.productId)
    return c.json({ ok: true })
  })

  /** Новая версия: копия активной на дату вступления (D3 — версия только при смене состава). */
  .post(
    '/cost/tech-cards/:id/versions',
    zValidator(
      'json',
      z.object({ validFrom: z.number().int().positive().optional(), note: z.string().max(300).optional() }),
    ),
    (c) => {
      requireWrite(c)
      const id = Number(c.req.param('id'))
      if (!cardRow(id)) throw bad('Техкарта не найдена', 404)
      const p = c.req.valid('json')
      const from = p.validFrom ?? now()
      const base = activeVersion(id, from)
      const versionId = db.transaction(() => {
        const info = db
          .prepare(`INSERT INTO tech_card_versions(card_id, valid_from, note, created_at) VALUES(?,?,?,?)`)
          .run(id, from, p.note ?? null, now())
        const vid = Number(info.lastInsertRowid)
        if (base) {
          const lines = linesOf(base.id)
          const ins = db.prepare(
            `INSERT INTO tech_card_lines(version_id, sort_order, stock_item_id, child_card_id, qty_brutto,
                                         loss_cold_pct, loss_hot_pct, qty_netto, qty_yield, line_role)
             VALUES(?,?,?,?,?,?,?,?,?,?)`,
          )
          for (const l of lines) {
            ins.run(
              vid,
              l.sortOrder,
              l.stockItemId,
              l.childCardId,
              l.qtyBrutto,
              l.lossColdPct,
              l.lossHotPct,
              l.qtyNetto,
              l.qtyYield,
              l.lineRole,
            )
          }
        }
        return vid
      })()
      return c.json({ ok: true, versionId, card: serializeCard(id, { versionId }) })
    },
  )

  .post('/cost/tech-cards/:id/publish', (c) => {
    requireWrite(c)
    const id = Number(c.req.param('id'))
    const card = cardRow(id)
    if (!card) throw bad('Техкарта не найдена', 404)
    const cycle = findCycle(cardGraph(), id)
    if (cycle) throw bad(`Заготовка входит сама в себя: ${cycle.join(' → ')}`, 400)
    db.prepare(`UPDATE tech_cards SET status='active', updated_at=? WHERE id=?`).run(now(), id)
    const projection = projectCard(id)
    return c.json({ ok: true, projection, card: serializeCard(id) })
  })

  .get('/cost/tech-cards/:id/usage', (c) => {
    const id = Number(c.req.param('id'))
    const rows = db
      .prepare(
        `SELECT DISTINCT v.card_id AS cardId, l.qty_brutto AS qty
           FROM tech_card_lines l JOIN tech_card_versions v ON v.id = l.version_id
          WHERE l.child_card_id=?`,
      )
      .all(id) as { cardId: number; qty: number }[]
    const usage = rows.map((r) => {
      const parent = serializeCard(r.cardId)
      return {
        cardId: r.cardId,
        name: parent?.name ?? `#${r.cardId}`,
        kind: parent?.kind ?? 'dish',
        qty: r.qty,
        costPerUnitRub: parent?.costPerUnitRub ?? null,
      }
    })
    const itemRows = db
      .prepare(
        `SELECT DISTINCT v.card_id AS cardId FROM tech_card_lines l JOIN tech_card_versions v ON v.id=l.version_id
          WHERE l.child_card_id=?`,
      )
      .all(id)
    return c.json({ usage, parents: itemRows.length })
  })

  /** Ингредиенты = позиции склада + цена и её источник. */
  .get('/cost/items', (c) => {
    const q = (c.req.query('q') || '').trim().toLowerCase()
    const onlyProblems = c.req.query('problems') === '1'
    const costs = unitCostMap()
    const rows = db
      .prepare(
        `SELECT id, name, unit, kind, active, weight_per_pc_kg AS weightPerPcKg, density_kg_l AS densityKgL,
                manual_cost_kop AS manualCostKop, notes
           FROM stock_items WHERE active=1 ORDER BY name COLLATE NOCASE`,
      )
      .all() as ItemRow[]
    const used = new Map(
      (
        db
          .prepare(
            `SELECT l.stock_item_id AS itemId, COUNT(DISTINCT v.card_id) AS n
               FROM tech_card_lines l JOIN tech_card_versions v ON v.id=l.version_id
              GROUP BY l.stock_item_id`,
          )
          .all() as { itemId: number; n: number }[]
      ).map((r) => [r.itemId, r.n]),
    )
    const items = rows
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .map((r) => {
        const cost = costs.get(r.id) ?? { costKop: null, source: 'none' }
        return {
          id: r.id,
          name: r.name,
          unit: r.unit,
          kind: r.kind,
          weightPerPcKg: r.weightPerPcKg,
          densityKgL: r.densityKgL,
          manualCostRub: rub(r.manualCostKop),
          costRub: rub(cost.costKop),
          costSource: cost.source,
          cards: used.get(r.id) ?? 0,
          notes: r.notes,
          problems: cost.costKop == null ? ['нет цены'] : r.unit === 'pcs' && !r.weightPerPcKg ? ['не задан вес штуки'] : [],
        }
      })
    return c.json({ items: onlyProblems ? items.filter((i) => i.problems.length) : items })
  })

  .put(
    '/cost/items/:id',
    zValidator(
      'json',
      z.object({
        manualCostRub: z.number().nonnegative().nullable().optional(),
        weightPerPcKg: z.number().positive().nullable().optional(),
        densityKgL: z.number().positive().nullable().optional(),
        notes: z.string().max(300).nullable().optional(),
      }),
    ),
    (c) => {
      requireWrite(c)
      const id = Number(c.req.param('id'))
      const cur = itemById(id)
      if (!cur) throw bad('Позиция не найдена', 404)
      const p = c.req.valid('json')
      const manual = p.manualCostRub !== undefined ? kop(p.manualCostRub) : cur.manualCostKop
      db.transaction(() => {
        db.prepare(`UPDATE stock_items SET manual_cost_kop=?, weight_per_pc_kg=?, density_kg_l=?, notes=?, updated_at=? WHERE id=?`).run(
          manual,
          p.weightPerPcKg !== undefined ? p.weightPerPcKg : cur.weightPerPcKg,
          p.densityKgL !== undefined ? p.densityKgL : cur.densityKgL,
          p.notes !== undefined ? p.notes : cur.notes,
          now(),
          id,
        )
        if (p.manualCostRub !== undefined && manual != null) {
          db.prepare(
            `INSERT INTO stock_item_cost_history(stock_item_id, at, cost_kop, source) VALUES(?,?,?,'manual')`,
          ).run(id, now(), manual)
        }
      })()
      return c.json({ ok: true })
    },
  )

  .get('/cost/items/:id/price-history', (c) => {
    const id = Number(c.req.param('id'))
    if (!itemById(id)) throw bad('Позиция не найдена', 404)
    const history = db
      .prepare(
        `SELECT at, cost_kop AS costKop, source FROM stock_item_cost_history WHERE stock_item_id=? ORDER BY at`,
      )
      .all(id) as { at: number; costKop: number; source: string }[]
    const invoices = db
      .prepare(
        `SELECT i.posted_at AS at, l.qty, l.unit_cost_kop AS unitCostKop, i.number
           FROM purchase_invoice_lines l JOIN purchase_invoices i ON i.id=l.invoice_id
          WHERE l.stock_item_id=? AND i.status='posted' ORDER BY i.posted_at`,
      )
      .all(id) as { at: number; qty: number; unitCostKop: number; number: string | null }[]
    return c.json({
      history: history.map((h) => ({ at: h.at, costRub: rub(h.costKop), source: h.source })),
      purchases: invoices.map((i) => ({ at: i.at, qty: i.qty, unitCostRub: rub(i.unitCostKop), number: i.number })),
    })
  })

  /** Сводка проблем по всем картам: то, что владелец должен увидеть сам. */
  .get('/cost/insights', (c) => {
    const ids = (db.prepare(`SELECT id FROM tech_cards ORDER BY name`).all() as { id: number }[]).map((r) => r.id)
    const cards = ids.map((id) => serializeCard(id)).filter(Boolean)
    const rows = cards.flatMap((card) =>
      card!.insights.map((i) => ({ cardId: card!.id, name: card!.name, code: i.code, text: i.text, tone: i.tone })),
    )
    const byCode = new Map<string, number>()
    for (const r of rows) byCode.set(r.code, (byCode.get(r.code) ?? 0) + 1)
    return c.json({ rows, summary: [...byCode.entries()].map(([code, count]) => ({ code, count })) })
  })

  /** Массовая замена ингредиента во всех картах (или в выбранных) с коэффициентом. */
  .post(
    '/cost/bulk/replace-ingredient',
    zValidator(
      'json',
      z.object({
        fromStockItemId: z.number().int().positive(),
        toStockItemId: z.number().int().positive(),
        factor: z.number().positive().max(1000).optional(),
        cardIds: z.array(z.number().int().positive()).optional(),
      }),
    ),
    (c) => {
      requireWrite(c)
      const p = c.req.valid('json')
      if (!itemById(p.fromStockItemId) || !itemById(p.toStockItemId)) throw bad('Позиция склада не найдена', 404)
      const factor = p.factor ?? 1
      const result = db.transaction(() => {
        const affected = db
          .prepare(
            `SELECT DISTINCT v.card_id AS cardId FROM tech_card_lines l
               JOIN tech_card_versions v ON v.id=l.version_id
              WHERE l.stock_item_id=?`,
          )
          .all(p.fromStockItemId) as { cardId: number }[]
        const ids = p.cardIds ? affected.filter((a) => p.cardIds!.includes(a.cardId)) : affected
        let lines = 0
        for (const { cardId } of ids) {
          const v = activeVersion(cardId)
          if (!v) continue
          const r = db
            .prepare(
              `UPDATE tech_card_lines SET stock_item_id=?, qty_brutto=ROUND(qty_brutto*?, 3)
                WHERE version_id=? AND stock_item_id=?`,
            )
            .run(p.toStockItemId, factor, v.id, p.fromStockItemId)
          lines += r.changes
          projectCard(cardId)
        }
        return { cards: ids.length, lines }
      })()
      return c.json({ ok: true, ...result })
    },
  )

  /** Массовая правка потерь по выбранным картам. */
  .post(
    '/cost/bulk/loss-pct',
    zValidator(
      'json',
      z.object({
        cardIds: z.array(z.number().int().positive()).min(1),
        stockItemId: z.number().int().positive().optional(),
        lossColdPct: z.number().min(-500).max(100),
        lossHotPct: z.number().min(-500).max(100).optional(),
      }),
    ),
    (c) => {
      requireWrite(c)
      const p = c.req.valid('json')
      let lines = 0
      db.transaction(() => {
        for (const cardId of p.cardIds) {
          const v = activeVersion(cardId)
          if (!v) continue
          const r = p.stockItemId
            ? db
                .prepare(
                  `UPDATE tech_card_lines SET loss_cold_pct=?, loss_hot_pct=COALESCE(?, loss_hot_pct)
                    WHERE version_id=? AND stock_item_id=?`,
                )
                .run(p.lossColdPct, p.lossHotPct ?? null, v.id, p.stockItemId)
            : db
                .prepare(
                  `UPDATE tech_card_lines SET loss_cold_pct=?, loss_hot_pct=COALESCE(?, loss_hot_pct)
                    WHERE version_id=? AND child_card_id IS NULL`,
                )
                .run(p.lossColdPct, p.lossHotPct ?? null, v.id)
          lines += r.changes
          projectCard(cardId)
        }
      })()
      return c.json({ ok: true, lines })
    },
  )

  /** Сводка v2: карты, фудкост, маржа, проблемы — вместо старого /cost/summary. */
  .get('/cost/overview', (c) => {
    const ids = (db.prepare(`SELECT id FROM tech_cards ORDER BY name`).all() as { id: number }[]).map((r) => r.id)
    const cards = ids
      .map((id) => serializeCard(id))
      .filter((c): c is NonNullable<ReturnType<typeof serializeCard>> => c !== null)
    const withCost = cards.filter((c) => c.costPerUnitRub != null && c.retailRub != null)
    const avgFoodCost =
      withCost.length > 0
        ? Math.round((withCost.reduce((s, c) => s + (c.foodCostPct ?? 0), 0) / withCost.length) * 10) / 10
        : null
    return c.json({
      cards: cards.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        status: c.status,
        costPerUnitRub: c.costPerUnitRub,
        retailRub: c.retailRub,
        foodCostPct: c.foodCostPct,
        marginRub: c.marginRub,
        insights: c.insights,
      })),
      avgFoodCostPct: avgFoodCost,
      problems: cards.filter((c) => c.insights.length > 0).length,
      cardsTotal: cards.length,
    })
  })
