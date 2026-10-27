/**
 * Единый помощник списания по FEFO (Q-08, Q-09).
 *
 * D-20: подходят партии своей точки и «общего склада» (NULL), чужая точка — никогда.
 * Порядок: ближайший срок годности, партии без срока в конце, затем id.
 *
 * Любое списание (продажа, инвентаризация, возврат поставщику, ручное списание) идёт через
 * эту функцию, поэтому `Σ stock_movements.qty` и `Σ stock_batches.qty_left` не расходятся.
 */
import type Database from 'better-sqlite3'

export type ConsumeFefoInput = {
  stockItemId: number
  /** Сколько нужно списать (положительное число в единице позиции). */
  need: number
  /** `null` — списываем с общего склада с любых партий. */
  storeUuid: string | null
  kind: 'sale_out' | 'inventory_adj' | 'return' | 'write_off' | 'sale_back'
  docType: string
  docId: string | number
  note: string
  noBatchNote: string
  now: number
  refDocId?: string | null
}

/** Возвращает величину нехватки (0 — партий хватило). */
export function consumeFefo(db: Database.Database, o: ConsumeFefoInput): number {
  const batches = db
    .prepare(
      `SELECT id, qty_left AS qtyLeft FROM stock_batches
       WHERE stock_item_id=? AND qty_left>0 AND (? IS NULL OR store_uuid=? OR store_uuid IS NULL)
       ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC`,
    )
    .all(o.stockItemId, o.storeUuid, o.storeUuid) as { id: number; qtyLeft: number }[]

  const take = db.prepare(`UPDATE stock_batches SET qty_left = qty_left - ? WHERE id=?`)
  const ins = db.prepare(
    `INSERT INTO stock_movements(stock_item_id, batch_id, store_uuid, qty, kind, doc_type, doc_id, ref_doc_id, note, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  )

  let left = o.need
  for (const b of batches) {
    if (left <= 1e-9) break
    const part = Math.min(b.qtyLeft, left)
    if (!(part > 0)) continue
    take.run(part, b.id)
    ins.run(o.stockItemId, b.id, o.storeUuid, -part, o.kind, o.docType, o.docId, o.refDocId ?? null, o.note, o.now)
    left -= part
  }
  if (left > 1e-9) {
    // Нехватка (D-21): доводим движение без партии, чтобы остаток ушёл в минус и был виден.
    ins.run(o.stockItemId, null, o.storeUuid, -left, o.kind, o.docType, o.docId, o.refDocId ?? null, o.noBatchNote, o.now)
  }
  return Math.max(0, left)
}
