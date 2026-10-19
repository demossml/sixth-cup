/**
 * Soft stock write-off on Evotor SELL by product_stock_norms (audit: sale consumes norm).
 * Never throws into loyalty path — missing norms / empty stock only log and skip.
 */
import type Database from 'better-sqlite3'

function consumeFefo(
  db: Database.Database,
  stockItemId: number,
  need: number,
  storeUuid: string,
  docId: string,
  now: number,
): void {
  let left = need
  const batches = db
    .prepare(
      `SELECT id, qty_left FROM stock_batches
       WHERE stock_item_id=? AND qty_left>0
       ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC`,
    )
    .all(stockItemId) as { id: number; qty_left: number }[]

  for (const b of batches) {
    if (left <= 0) break
    const take = Math.min(b.qty_left, left)
    db.prepare(`UPDATE stock_batches SET qty_left = qty_left - ? WHERE id=?`).run(take, b.id)
    db.prepare(
      `INSERT INTO stock_movements(stock_item_id, batch_id, store_uuid, qty, kind, doc_type, doc_id, note, created_at)
       VALUES(?,?,?,?,'sale_out','evotor_sell',?,?,?)`,
    ).run(stockItemId, b.id, storeUuid, -take, docId, 'Списание по продаже (норма)', now)
    left -= take
  }
  if (left > 0) {
    // Still record movement without batch — expected goes negative / short (visible as risk)
    db.prepare(
      `INSERT INTO stock_movements(stock_item_id, batch_id, store_uuid, qty, kind, doc_type, doc_id, note, created_at)
       VALUES(?,NULL,?,?,'sale_out','evotor_sell',?,?,?)`,
    ).run(stockItemId, storeUuid, -left, docId, 'Списание без партии (недостаток)', now)
  }
}

/**
 * Call inside the same transaction as SELL success, or after — idempotent per docId+item.
 */
export function writeOffSellByNorms(
  db: Database.Database,
  storeUuid: string,
  docId: string,
  positions: { productUuid: string | null; qty: number }[],
): void {
  try {
    if (!positions.length) return
    // Skip if already written for this doc
    const exists = db
      .prepare(`SELECT 1 FROM stock_movements WHERE doc_type='evotor_sell' AND doc_id=? LIMIT 1`)
      .get(docId)
    if (exists) return

    const now = Date.now()
    const findProduct = db.prepare(
      `SELECT p.id FROM products p
       JOIN product_store_links l ON l.product_id = p.id
       WHERE l.evotor_uuid = ? LIMIT 1`,
    )
    const findProductByAny = db.prepare(
      `SELECT product_id AS id FROM product_store_links WHERE evotor_uuid=? LIMIT 1`,
    )
    const normsFor = db.prepare(
      `SELECT stock_item_id AS stockItemId, qty FROM product_stock_norms WHERE product_id=?`,
    )

    for (const pos of positions) {
      if (!pos.productUuid || !(pos.qty > 0)) continue
      let prod = findProduct.get(pos.productUuid) as { id: number } | undefined
      if (!prod) prod = findProductByAny.get(pos.productUuid) as { id: number } | undefined
      if (!prod) continue
      const norms = normsFor.all(prod.id) as { stockItemId: number; qty: number }[]
      for (const n of norms) {
        const need = n.qty * pos.qty
        if (!(need > 0)) continue
        consumeFefo(db, n.stockItemId, need, storeUuid, docId, now)
      }
    }
  } catch {
    // Soft: never break SELL/loyalty
  }
}
