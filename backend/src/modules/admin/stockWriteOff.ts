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
import { consumeFefo } from './stockFefo'

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
        consumeFefo(db, {
          stockItemId: n.stockItemId,
          need,
          storeUuid,
          kind: 'sale_out',
          docType: 'evotor_sell',
          docId,
          note: 'Списание по продаже (норма)',
          noBatchNote: 'Списание без партии (недостаток)',
          now,
        })
        res.written++
      }
    }
  })()

  return res
}

export type RestoreResult = {
  /** Возврат по этому документу уже обработан. */
  duplicate: boolean
  /** Сколько строк позиций склада получило движение возврата. */
  restoredItems: number
  /** Почему ничего не вернули (нет прошлого списания по базовому чеку). */
  reason?: 'no_prior_sale_out'
}

type SaleOutRow = { id: number; stock_item_id: number; batch_id: number | null; qty: number }

/**
 * Возврат сырья при PAYBACK (Q-02). Возвращаем только то, что реально было списано
 * по базовому чеку (D-07), не больше `списано − уже возвращено` (D-08),
 * в те же партии LIFO с капом по `qty_in` (D-09).
 */
export function restoreByPayback(
  db: Database.Database,
  storeUuid: string,
  paybackId: string,
  baseId: string,
  positions: { productUuid: string | null; qty: number }[],
): RestoreResult {
  const res: RestoreResult = { duplicate: false, restoredItems: 0 }

  const findProduct = db.prepare(
    `SELECT p.id FROM products p
     JOIN product_store_links l ON l.product_id = p.id
     WHERE l.evotor_uuid = ? LIMIT 1`,
  )
  const findProductByAny = db.prepare(`SELECT product_id AS id FROM product_store_links WHERE evotor_uuid=? LIMIT 1`)
  const normsFor = db.prepare(`SELECT stock_item_id AS stockItemId, qty FROM product_stock_norms WHERE product_id=?`)

  db.transaction(() => {
    const done = db
      .prepare(`SELECT 1 FROM stock_movements WHERE doc_type='evotor_payback' AND doc_id=? LIMIT 1`)
      .get(paybackId)
    if (done) {
      res.duplicate = true
      return
    }

    const orig = db
      .prepare(
        `SELECT id, stock_item_id, batch_id, qty FROM stock_movements
         WHERE doc_type='evotor_sell' AND doc_id=? AND kind='sale_out'
         ORDER BY id DESC`,
      )
      .all(baseId) as SaleOutRow[]
    if (!orig.length) {
      res.reason = 'no_prior_sale_out'
      return
    }

    const soldByItem = new Map<number, number>()
    for (const r of orig) soldByItem.set(r.stock_item_id, (soldByItem.get(r.stock_item_id) ?? 0) - r.qty)

    const backRows = db
      .prepare(
        `SELECT stock_item_id, COALESCE(SUM(qty),0) AS q FROM stock_movements
         WHERE doc_type='evotor_payback' AND ref_doc_id=?
         GROUP BY stock_item_id`,
      )
      .all(baseId) as { stock_item_id: number; q: number }[]
    const backByItem = new Map(backRows.map((r) => [r.stock_item_id, r.q]))

    // Сколько вернуть по каждой позиции склада: по нормам возвращаемых товаров, но не больше остатка.
    const target = new Map<number, number>()
    if (positions.length) {
      for (const pos of positions) {
        if (!pos.productUuid || !(pos.qty > 0)) continue
        let prod = findProduct.get(pos.productUuid) as { id: number } | undefined
        if (!prod) prod = findProductByAny.get(pos.productUuid) as { id: number } | undefined
        if (!prod) continue
        for (const n of normsFor.all(prod.id) as { stockItemId: number; qty: number }[]) {
          const need = n.qty * pos.qty
          if (!(need > 0)) continue
          target.set(n.stockItemId, (target.get(n.stockItemId) ?? 0) + need)
        }
      }
    }
    if (!target.size) {
      // Нераспознанные позиции возврата — возвращаем весь остаток списанного (D-08).
      for (const [itemId, sold] of soldByItem) target.set(itemId, sold)
    }

    const now = Date.now()
    const addBatch = db.prepare(`UPDATE stock_batches SET qty_left = MIN(qty_in, qty_left + ?) WHERE id=?`)
    const insMovement = db.prepare(
      `INSERT INTO stock_movements(stock_item_id, batch_id, store_uuid, qty, kind, doc_type, doc_id, ref_doc_id, note, created_at)
       VALUES(?,?,?,?,'sale_back','evotor_payback',?,?,?,?)`,
    )

    for (const [itemId, want] of target) {
      const sold = soldByItem.get(itemId) ?? 0
      const remaining = Math.max(0, sold - (backByItem.get(itemId) ?? 0))
      let left = Math.min(want, remaining)
      if (left <= 1e-9) continue
      let wrote = false
      for (const row of orig) {
        if (left <= 1e-9) break
        if (row.stock_item_id !== itemId) continue
        const take = Math.min(-row.qty, left)
        if (!(take > 0)) continue
        if (row.batch_id != null) addBatch.run(take, row.batch_id)
        insMovement.run(itemId, row.batch_id, storeUuid, take, paybackId, baseId, 'Возврат чека (сырьё)', now)
        left -= take
        wrote = true
      }
      if (!wrote && left > 1e-9) {
        insMovement.run(itemId, null, storeUuid, left, paybackId, baseId, 'Возврат чека без партии', now)
      }
      res.restoredItems++
    }
  })()

  return res
}
