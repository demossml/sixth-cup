/**
 * Общие хелперы тестов склада W0–W2. Файл не матчится как тест (нет суффикса `.test.ts`).
 *
 * Все запросы идут через `app.request`, как в `bank-row-pay.test.ts`: `setup-isolated-db.ts`
 * уже подставил временную БД до импорта модулей.
 */
import { expect } from 'vitest'
import { app } from '../app'
import { db } from '../db'
import { config } from '../config'

export const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }

export type CallResult = { status: number; json: any }

export async function admin(method: string, path: string, body?: unknown): Promise<CallResult> {
  const r = await app.request(`/api/admin${path}`, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any }
}

/** Сумма движений по позиции склада (при желании — только по одной точке). */
export function balance(stockItemId: number, storeUuid?: string | null): number {
  const row = storeUuid
    ? db
        .prepare(`SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements WHERE stock_item_id=? AND store_uuid=?`)
        .get(stockItemId, storeUuid)
    : db.prepare(`SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements WHERE stock_item_id=?`).get(stockItemId)
  return Number((row as { q: number }).q)
}

/** Сумма `qty_left` партий позиции. */
export function batchLeft(stockItemId: number): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(qty_left),0) AS q FROM stock_batches WHERE stock_item_id=?`)
    .get(stockItemId)
  return Number((row as { q: number }).q)
}

export function movements(stockItemId: number): { qty: number; kind: string; batchId: number | null; docType: string; docId: string }[] {
  return db
    .prepare(
      `SELECT qty, kind, batch_id AS batchId, doc_type AS docType, doc_id AS docId
       FROM stock_movements WHERE stock_item_id=? ORDER BY id`,
    )
    .all(stockItemId) as any
}

export async function createItem(name: string, unit = 'g', extra: Record<string, unknown> = {}): Promise<number> {
  const r = await admin('POST', '/stock/items', { name, unit, ...extra })
  expect(r.status).toBe(201)
  return r.json.id as number
}

export async function createSupplier(name: string): Promise<number> {
  const r = await admin('POST', '/suppliers', { name })
  expect(r.status).toBe(201)
  return r.json.id as number
}

/**
 * Приход: черновик накладной + проведение. Создаёт партию и движение `purchase_in`.
 * Возвращает id накладной.
 */
export async function receive(
  supplierId: number,
  lines: { stockItemId: number; qty: number; unitCostKop?: number }[],
  opts: { storeUuid?: string | null; expiresAt?: number | null } = {},
): Promise<number> {
  const inv = await admin('POST', '/purchases/invoices', {
    supplierId,
    storeUuid: opts.storeUuid ?? null,
    lines: lines.map((l) => ({ ...l, unitCostKop: l.unitCostKop ?? 1000, expiresAt: opts.expiresAt ?? null })),
  })
  expect(inv.status).toBe(201)
  const posted = await admin('POST', `/purchases/invoices/${inv.json.id}/post`)
  expect(posted.status).toBe(200)
  return inv.json.id as number
}

/** Товар меню + связь с Эвотором + норма на позицию склада. */
export async function productWithNorm(
  productId: number,
  evotorUuid: string,
  storeUuid: string,
  stockItemId: number,
  qty: number,
): Promise<void> {
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,counts_as_cup) VALUES(?,?,150,1)`).run(
    productId,
    `Товар ${productId}`,
  )
  db.prepare(`INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)`).run(
    productId,
    storeUuid,
    evotorUuid,
  )
  const r = await admin('POST', '/stock/norms', { productId, stockItemId, qty })
  expect(r.status).toBe(200)
}

export function loyaltyOps(docId?: string): number {
  const row = docId
    ? db.prepare(`SELECT COUNT(*) AS n FROM loyalty_ops WHERE doc_id=?`).get(docId)
    : db.prepare(`SELECT COUNT(*) AS n FROM loyalty_ops`).get()
  return Number((row as { n: number }).n)
}

export function docStatus(storeUuid: string, docId: string): string | undefined {
  const row = db
    .prepare(`SELECT status FROM evotor_docs WHERE store_uuid=? AND doc_id=?`)
    .get(storeUuid, docId) as { status: string } | undefined
  return row?.status
}

export function docLastError(storeUuid: string, docId: string): string | null {
  const row = db
    .prepare(`SELECT last_error AS e FROM evotor_docs WHERE store_uuid=? AND doc_id=?`)
    .get(storeUuid, docId) as { e: string | null } | undefined
  return row?.e ?? null
}

/** Документ SELL в формате облака Эвотора. */
export function sellDoc(
  uuid: string,
  positions: { commodityUuid: string; qty: number; price?: number }[],
  extras: unknown = {},
): Record<string, unknown> {
  return {
    uuid,
    type: 'SELL',
    closeDate: new Date().toISOString(),
    extras,
    transactions: positions.map((p) => ({
      type: 'REGISTER_POSITION',
      commodityUuid: p.commodityUuid,
      quantity: p.qty,
      price: p.price ?? 15000,
      sum: (p.price ?? 15000) * p.qty,
    })),
    closeSum: String(positions.reduce((s, p) => s + (p.price ?? 15000) * p.qty, 0)),
  }
}

/** Документ PAYBACK в формате облака Эвотора. */
export function paybackDoc(
  uuid: string,
  baseDocumentUUID: string,
  positions: { commodityUuid: string; qty: number; price?: number }[],
  extras: unknown = {},
): Record<string, unknown> {
  return {
    uuid,
    type: 'PAYBACK',
    baseDocumentUUID,
    closeDate: new Date().toISOString(),
    extras,
    transactions: positions.map((p) => ({
      type: 'REGISTER_POSITION',
      commodityUuid: p.commodityUuid,
      quantity: p.qty,
      price: p.price ?? 15000,
      sum: (p.price ?? 15000) * p.qty,
    })),
    closeSum: String(positions.reduce((s, p) => s + (p.price ?? 15000) * p.qty, 0)),
  }
}
