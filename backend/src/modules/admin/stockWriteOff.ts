/**
 * Списание сырья на складе по нормам `product_stock_norms` на каждый чек кассы (Q-01).
 *
 * Вызывается из `PollService` (а не из `handleSell`), чтобы склад работал и на чеках
 * без карты лояльности. Ошибки не глотаются: их обрабатывает вызывающий код (Q-05).
 *
 * D-05: весь чек списывается одной транзакцией — либо все строки, либо ни одной.
 * D-06: идемпотентность по `doc_type='evotor_sell' AND doc_id=<uuid чека>`.
 */
import type Database from 'better-sqlite3'

export type WriteOffResult = {
  /** Движения по этому чеку уже есть — повторная обработка ничего не пишет. */
  duplicate: boolean
  /** Сколько строк норм реально списано. */
  written: number
  /** Позиции чека без связи с товаром меню. */
  skippedNoProduct: number
  /** Товар найден, но норм у него нет. */
  skippedNoNorms: number
}

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
    // Нехватка (D-21): продажу не блокируем, остаток уходит в минус — движение без партии.
    db.prepare(
      `INSERT INTO stock_movements(stock_item_id, batch_id, store_uuid, qty, kind, doc_type, doc_id, note, created_at)
       VALUES(?,NULL,?,?,'sale_out','evotor_sell',?,?,?)`,
    ).run(stockItemId, storeUuid, -left, docId, 'Списание без партии (недостаток)', now)
  }
}

/** Списание по нормам для одного документа продажи. Бросает ошибки — их ловит вызывающий. */
export function writeOffSellByNorms(
  db: Database.Database,
  storeUuid: string,
  docId: string,
  positions: { productUuid: string | null; qty: number }[],
): WriteOffResult {
  const res: WriteOffResult = { duplicate: false, written: 0, skippedNoProduct: 0, skippedNoNorms: 0 }
  if (!positions.length) return res

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

  db.transaction(() => {
    const exists = db
      .prepare(`SELECT 1 FROM stock_movements WHERE doc_type='evotor_sell' AND doc_id=? LIMIT 1`)
      .get(docId)
    if (exists) {
      res.duplicate = true
      return
    }

    const now = Date.now()
    for (const pos of positions) {
      if (!pos.productUuid || !(pos.qty > 0)) continue
      let prod = findProduct.get(pos.productUuid) as { id: number } | undefined
      if (!prod) prod = findProductByAny.get(pos.productUuid) as { id: number } | undefined
      if (!prod) {
        res.skippedNoProduct++
        continue
      }
      const norms = normsFor.all(prod.id) as { stockItemId: number; qty: number }[]
      if (!norms.length) {
        res.skippedNoNorms++
        continue
      }
      for (const n of norms) {
        const need = n.qty * pos.qty
        if (!(need > 0)) continue
        consumeFefo(db, n.stockItemId, need, storeUuid, docId, now)
        res.written++
      }
    }
  })()

  return res
}
