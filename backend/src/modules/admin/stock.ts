/**
 * Stock + purchases + inventory admin API — design-project (audit) v1.
 * Balances change only via posted documents. Batches support FEFO read-outs.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'

const now = () => Date.now()

function expectedQty(stockItemId: number, storeUuid?: string | null): number {
  if (storeUuid) {
    const r = db
      .prepare(
        `SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements WHERE stock_item_id=? AND (store_uuid IS ? OR store_uuid=?)`,
      )
      .get(stockItemId, storeUuid, storeUuid) as { q: number }
    return Number(r.q) || 0
  }
  const r = db
    .prepare(`SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements WHERE stock_item_id=?`)
    .get(stockItemId) as { q: number }
  return Number(r.q) || 0
}

function batchLeft(stockItemId: number): number {
  const r = db
    .prepare(`SELECT COALESCE(SUM(qty_left),0) AS q FROM stock_batches WHERE stock_item_id=?`)
    .get(stockItemId) as { q: number }
  return Number(r.q) || 0
}

const itemBody = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().max(64).optional().nullable(),
  kind: z.enum(['raw', 'unit']).optional(),
  unit: z.enum(['kg', 'l', 'pcs', 'g', 'ml']).optional(),
  minQty: z.number().min(0).optional(),
  multiplicity: z.number().positive().optional(),
  shelfLifeDays: z.number().int().positive().optional().nullable(),
  defaultSupplierId: z.number().int().positive().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  active: z.boolean().optional(),
})

const supplierBody = z.object({
  name: z.string().min(1).max(200),
  inn: z.string().max(32).optional().nullable(),
  contact: z.string().max(200).optional().nullable(),
  phone: z.string().max(64).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  bankDetails: z.string().max(2000).optional().nullable(),
  paymentDelayDays: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional().nullable(),
  active: z.boolean().optional(),
})

export const adminStock = new Hono()

  /* ───── Stock items (nomenclature) ───── */
  .get('/stock/items', (c) => {
    const active = c.req.query('active')
    const rows = db
      .prepare(
        `SELECT id, name, sku, kind, unit,
                min_qty AS minQty, multiplicity, shelf_life_days AS shelfLifeDays,
                default_supplier_id AS defaultSupplierId, notes, active,
                created_at AS createdAt, updated_at AS updatedAt
         FROM stock_items
         WHERE (? IS NULL OR active = ?)
         ORDER BY name COLLATE NOCASE`,
      )
      .all(active === undefined ? null : active === '1' || active === 'true' ? 1 : 0,
           active === undefined ? null : active === '1' || active === 'true' ? 1 : 0) as Record<string, unknown>[]
    const items = rows.map((r) => {
      const id = Number(r.id)
      const expected = expectedQty(id)
      const left = batchLeft(id)
      const minQty = Number(r.minQty) || 0
      let level: 'ok' | 'low' | 'out' = 'ok'
      if (expected <= 0) level = 'out'
      else if (minQty > 0 && expected < minQty) level = 'low'
      return { ...r, expectedQty: expected, batchQtyLeft: left, level }
    })
    return c.json({ items })
  })

  .get('/stock/items/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) throw bad('Invalid id', 400)
    const r = db
      .prepare(
        `SELECT id, name, sku, kind, unit,
                min_qty AS minQty, multiplicity, shelf_life_days AS shelfLifeDays,
                default_supplier_id AS defaultSupplierId, notes, active,
                created_at AS createdAt, updated_at AS updatedAt
         FROM stock_items WHERE id=?`,
      )
      .get(id) as Record<string, unknown> | undefined
    if (!r) throw bad('Позиция не найдена', 404)
    const batches = db
      .prepare(
        `SELECT id, lot_code AS lotCode, qty_in AS qtyIn, qty_left AS qtyLeft,
                unit_cost_kop AS unitCostKop, expires_at AS expiresAt,
                supplier_id AS supplierId, store_uuid AS storeUuid, created_at AS createdAt
         FROM stock_batches WHERE stock_item_id=? AND qty_left > 0
         ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC`,
      )
      .all(id)
    const norms = db
      .prepare(
        `SELECT n.id, n.product_id AS productId, n.qty, p.name AS productName
         FROM product_stock_norms n
         LEFT JOIN products p ON p.id = n.product_id
         WHERE n.stock_item_id=?`,
      )
      .all(id)
    return c.json({
      item: { ...r, expectedQty: expectedQty(id), batchQtyLeft: batchLeft(id) },
      batches,
      norms,
    })
  })

  .post('/stock/items', zValidator('json', itemBody), (c) => {
    const p = c.req.valid('json')
    const t = now()
    const info = db
      .prepare(
        `INSERT INTO stock_items(name, sku, kind, unit, min_qty, multiplicity, shelf_life_days, default_supplier_id, notes, active, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.name,
        p.sku ?? null,
        p.kind ?? 'raw',
        p.unit ?? 'kg',
        p.minQty ?? 0,
        p.multiplicity ?? 1,
        p.shelfLifeDays ?? null,
        p.defaultSupplierId ?? null,
        p.notes ?? null,
        p.active === false ? 0 : 1,
        t,
        t,
      )
    return c.json({ id: Number(info.lastInsertRowid) }, 201)
  })

  .patch('/stock/items/:id', zValidator('json', itemBody.partial()), (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) throw bad('Invalid id', 400)
    const cur = db.prepare(`SELECT id FROM stock_items WHERE id=?`).get(id)
    if (!cur) throw bad('Позиция не найдена', 404)
    const p = c.req.valid('json')
    const row = db.prepare(`SELECT * FROM stock_items WHERE id=?`).get(id) as Record<string, unknown>
    db.prepare(
      `UPDATE stock_items SET name=?, sku=?, kind=?, unit=?, min_qty=?, multiplicity=?, shelf_life_days=?,
       default_supplier_id=?, notes=?, active=?, updated_at=? WHERE id=?`,
    ).run(
      p.name ?? row.name,
      p.sku !== undefined ? p.sku : row.sku,
      p.kind ?? row.kind,
      p.unit ?? row.unit,
      p.minQty !== undefined ? p.minQty : row.min_qty,
      p.multiplicity !== undefined ? p.multiplicity : row.multiplicity,
      p.shelfLifeDays !== undefined ? p.shelfLifeDays : row.shelf_life_days,
      p.defaultSupplierId !== undefined ? p.defaultSupplierId : row.default_supplier_id,
      p.notes !== undefined ? p.notes : row.notes,
      p.active !== undefined ? (p.active ? 1 : 0) : row.active,
      now(),
      id,
    )
    return c.json({ ok: true })
  })

  .delete('/stock/items/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) throw bad('Invalid id', 400)
    if (!db.prepare(`SELECT id FROM stock_items WHERE id=?`).get(id)) throw bad('Позиция не найдена', 404)

    // Любая ссылка (движения, партии, нормы, строки документов) запрещает физическое удаление:
    // история остатков и себестоимость не должны рассыпаться. Вместо 500 — деактивация.
    const refs = [
      ['stock_movements', 'движения'],
      ['stock_batches', 'партии'],
      ['product_stock_norms', 'нормы списания'],
      ['inventory_lines', 'инвентаризации'],
      ['purchase_invoice_lines', 'накладные'],
      ['purchase_order_lines', 'заказы'],
      ['supplier_return_lines', 'возвраты'],
    ] as const
    const blocking: string[] = []
    for (const [table, label] of refs) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE stock_item_id=?`).get(id) as { n: number }
      if (row.n > 0) blocking.push(`${label} (${row.n})`)
    }
    if (blocking.length) {
      db.prepare(`UPDATE stock_items SET active=0, updated_at=? WHERE id=?`).run(now(), id)
      return c.json({
        ok: true,
        deactivated: true,
        reason: `Позиция используется: ${blocking.join(', ')}. Она выключена, история сохранена.`,
      })
    }
    db.prepare(`DELETE FROM stock_items WHERE id=?`).run(id)
    return c.json({ ok: true, deleted: true })
  })

  /* ───── Balances & expiry monitor ───── */
  .get('/stock/balances', (c) => {
    const storeUuid = c.req.query('storeUuid') || null
    const items = db
      .prepare(
        `SELECT id, name, sku, kind, unit, min_qty AS minQty, active
         FROM stock_items WHERE active=1 ORDER BY name COLLATE NOCASE`,
      )
      .all() as { id: number; name: string; sku: string | null; kind: string; unit: string; minQty: number; active: number }[]
    const balances = items.map((it) => {
      const expected = expectedQty(it.id, storeUuid)
      let level: 'ok' | 'low' | 'out' = 'ok'
      if (expected <= 0) level = 'out'
      else if (it.minQty > 0 && expected < it.minQty) level = 'low'
      return { ...it, expectedQty: expected, level }
    })
    const critical = balances.filter((b) => b.level !== 'ok').length
    return c.json({ balances, summary: { total: balances.length, critical } })
  })

  .get('/stock/expiry', (c) => {
    const days = Math.min(365, Math.max(1, Number(c.req.query('days') || 14)))
    const horizon = now() + days * 86_400_000
    const rows = db
      .prepare(
        `SELECT b.id, b.stock_item_id AS stockItemId, i.name AS itemName, i.unit,
                b.lot_code AS lotCode, b.qty_left AS qtyLeft, b.expires_at AS expiresAt,
                b.supplier_id AS supplierId, s.name AS supplierName
         FROM stock_batches b
         JOIN stock_items i ON i.id = b.stock_item_id
         LEFT JOIN suppliers s ON s.id = b.supplier_id
         WHERE b.qty_left > 0 AND b.expires_at IS NOT NULL AND b.expires_at <= ?
         ORDER BY b.expires_at ASC`,
      )
      .all(horizon) as {
        id: number
        stockItemId: number
        itemName: string
        unit: string
        lotCode: string | null
        qtyLeft: number
        expiresAt: number
        supplierId: number | null
        supplierName: string | null
      }[]
    const t = now()
    const batches = rows.map((r) => {
      const daysLeft = Math.floor((r.expiresAt - t) / 86_400_000)
      let urgency: 'expired' | 'urgent' | 'soon' = 'soon'
      if (daysLeft < 0) urgency = 'expired'
      else if (daysLeft <= 3) urgency = 'urgent'
      return { ...r, daysLeft, urgency }
    })
    return c.json({
      batches,
      summary: {
        expired: batches.filter((b) => b.urgency === 'expired').length,
        urgent: batches.filter((b) => b.urgency === 'urgent').length,
        soon: batches.filter((b) => b.urgency === 'soon').length,
      },
    })
  })

  /* ───── Norms ───── */
  .get('/stock/norms', (c) => {
    const productId = c.req.query('productId')
    const sql = productId
      ? `SELECT n.id, n.product_id AS productId, n.stock_item_id AS stockItemId, n.qty,
                p.name AS productName, i.name AS itemName, i.unit
         FROM product_stock_norms n
         LEFT JOIN products p ON p.id = n.product_id
         LEFT JOIN stock_items i ON i.id = n.stock_item_id
         WHERE n.product_id=?`
      : `SELECT n.id, n.product_id AS productId, n.stock_item_id AS stockItemId, n.qty,
                p.name AS productName, i.name AS itemName, i.unit
         FROM product_stock_norms n
         LEFT JOIN products p ON p.id = n.product_id
         LEFT JOIN stock_items i ON i.id = n.stock_item_id
         ORDER BY p.name COLLATE NOCASE`
    const norms = productId
      ? db.prepare(sql).all(Number(productId))
      : db.prepare(sql).all()
    return c.json({ norms })
  })

  .post(
    '/stock/norms',
    zValidator(
      'json',
      z.object({
        productId: z.number().int().positive(),
        stockItemId: z.number().int().positive(),
        qty: z.number().positive(),
      }),
    ),
    (c) => {
      const p = c.req.valid('json')
      if (!db.prepare(`SELECT id FROM products WHERE id=?`).get(p.productId)) throw bad('Товар не найден', 404)
      if (!db.prepare(`SELECT id FROM stock_items WHERE id=?`).get(p.stockItemId)) throw bad('Позиция склада не найдена', 404)
      db.prepare(
        `INSERT INTO product_stock_norms(product_id, stock_item_id, qty) VALUES(?,?,?)
         ON CONFLICT(product_id, stock_item_id) DO UPDATE SET qty=excluded.qty`,
      ).run(p.productId, p.stockItemId, p.qty)
      return c.json({ ok: true })
    },
  )

  .delete('/stock/norms/:id', (c) => {
    const id = Number(c.req.param('id'))
    db.prepare(`DELETE FROM product_stock_norms WHERE id=?`).run(id)
    return c.json({ ok: true })
  })

  /* Products without norms = risk (audit) */
  .get('/stock/products-without-norms', (c) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.price * 100 AS priceKop, p.price
         FROM products p
         WHERE p.available=1
           AND NOT EXISTS (SELECT 1 FROM product_stock_norms n WHERE n.product_id=p.id)
         ORDER BY p.name COLLATE NOCASE
         LIMIT 200`,
      )
      .all()
    return c.json({ products: rows })
  })

  /* ───── Suppliers ───── */
  .get('/suppliers', (c) => {
    const rows = db
      .prepare(
        `SELECT id, name, inn, contact, phone, email, bank_details AS bankDetails,
                payment_delay_days AS paymentDelayDays, notes, active,
                created_at AS createdAt, updated_at AS updatedAt
         FROM suppliers ORDER BY name COLLATE NOCASE`,
      )
      .all()
    return c.json({ suppliers: rows })
  })

  .post('/suppliers', zValidator('json', supplierBody), (c) => {
    const p = c.req.valid('json')
    const t = now()
    const info = db
      .prepare(
        `INSERT INTO suppliers(name, inn, contact, phone, email, bank_details, payment_delay_days, notes, active, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.name,
        p.inn ?? null,
        p.contact ?? null,
        p.phone ?? null,
        p.email ?? null,
        p.bankDetails ?? null,
        p.paymentDelayDays ?? 0,
        p.notes ?? null,
        p.active === false ? 0 : 1,
        t,
        t,
      )
    return c.json({ id: Number(info.lastInsertRowid) }, 201)
  })

  .patch('/suppliers/:id', zValidator('json', supplierBody.partial()), (c) => {
    const id = Number(c.req.param('id'))
    const cur = db.prepare(`SELECT * FROM suppliers WHERE id=?`).get(id) as Record<string, unknown> | undefined
    if (!cur) throw bad('Поставщик не найден', 404)
    const p = c.req.valid('json')
    db.prepare(
      `UPDATE suppliers SET name=?, inn=?, contact=?, phone=?, email=?, bank_details=?,
       payment_delay_days=?, notes=?, active=?, updated_at=? WHERE id=?`,
    ).run(
      p.name ?? cur.name,
      p.inn !== undefined ? p.inn : cur.inn,
      p.contact !== undefined ? p.contact : cur.contact,
      p.phone !== undefined ? p.phone : cur.phone,
      p.email !== undefined ? p.email : cur.email,
      p.bankDetails !== undefined ? p.bankDetails : cur.bank_details,
      p.paymentDelayDays !== undefined ? p.paymentDelayDays : cur.payment_delay_days,
      p.notes !== undefined ? p.notes : cur.notes,
      p.active !== undefined ? (p.active ? 1 : 0) : cur.active,
      now(),
      id,
    )
    return c.json({ ok: true })
  })

  .delete('/suppliers/:id', (c) => {
    const id = Number(c.req.param('id'))
    const supplier = db.prepare(`SELECT id FROM suppliers WHERE id=?`).get(id)
    if (!supplier) throw bad('Поставщик не найден', 404)

    // Поставщика с документами нельзя удалить физически (FK), но и падать 500 нельзя:
    // выключаем его — справочник чистый, история и долги сохраняются.
    const deps = [
      ['purchase_invoices', 'накладные'],
      ['purchase_orders', 'заказы'],
      ['supplier_returns', 'возвраты'],
      ['supplier_reconciliations', 'сверки'],
      ['purchase_payments', 'оплаты'],
      ['bank_rows', 'строки выписки'],
      ['stock_batches', 'партии'],
    ] as const
    const blocking: string[] = []
    for (const [table, label] of deps) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE supplier_id=?`).get(id) as { n: number }
      if (row.n > 0) blocking.push(`${label} (${row.n})`)
    }
    // Позиции склада ссылаются на поставщика «по умолчанию» — обнуляем ссылку, удалять товар нельзя.
    db.prepare(`UPDATE stock_items SET default_supplier_id=NULL WHERE default_supplier_id=?`).run(id)

    if (blocking.length) {
      db.prepare(`UPDATE suppliers SET active=0, updated_at=? WHERE id=?`).run(now(), id)
      return c.json({ ok: true, deactivated: true, reason: `Есть документы: ${blocking.join(', ')}. Поставщик выключен.` })
    }
    db.prepare(`DELETE FROM suppliers WHERE id=?`).run(id)
    return c.json({ ok: true, deleted: true })
  })

  /* ───── Purchase invoices ───── */
  .get('/purchases/invoices', (c) => {
    const status = c.req.query('status')
    const rows = db
      .prepare(
        `SELECT i.id, i.supplier_id AS supplierId, s.name AS supplierName, i.store_uuid AS storeUuid,
                i.number, i.status, i.total_kop AS totalKop, i.paid_kop AS paidKop,
                i.due_at AS dueAt, i.posted_at AS postedAt, i.notes,
                i.created_at AS createdAt, i.updated_at AS updatedAt
         FROM purchase_invoices i
         JOIN suppliers s ON s.id = i.supplier_id
         WHERE (? IS NULL OR i.status = ?)
         ORDER BY i.id DESC
         LIMIT 200`,
      )
      .all(status ?? null, status ?? null)
    const open = (rows as { status: string; totalKop: number; paidKop: number }[]).filter(
      (r) => r.status === 'posted' && r.paidKop < r.totalKop,
    ).length
    return c.json({ invoices: rows, summary: { openDebt: open } })
  })

  .get('/purchases/invoices/:id', (c) => {
    const id = Number(c.req.param('id'))
    const inv = db
      .prepare(
        `SELECT i.id, i.supplier_id AS supplierId, s.name AS supplierName, i.store_uuid AS storeUuid,
                i.number, i.status, i.total_kop AS totalKop, i.paid_kop AS paidKop,
                i.due_at AS dueAt, i.posted_at AS postedAt, i.notes,
                i.created_at AS createdAt, i.updated_at AS updatedAt
         FROM purchase_invoices i
         JOIN suppliers s ON s.id = i.supplier_id
         WHERE i.id=?`,
      )
      .get(id) as Record<string, unknown> | undefined
    if (!inv) throw bad('Накладная не найдена', 404)
    const lines = db
      .prepare(
        `SELECT l.id, l.stock_item_id AS stockItemId, si.name AS itemName, si.unit,
                l.qty, l.unit_cost_kop AS unitCostKop, l.expires_at AS expiresAt,
                l.lot_code AS lotCode, l.batch_id AS batchId
         FROM purchase_invoice_lines l
         JOIN stock_items si ON si.id = l.stock_item_id
         WHERE l.invoice_id=?`,
      )
      .all(id)
    return c.json({ invoice: inv, lines })
  })

  .post(
    '/purchases/invoices',
    zValidator(
      'json',
      z.object({
        supplierId: z.number().int().positive(),
        storeUuid: z.string().max(64).optional().nullable(),
        number: z.string().max(64).optional().nullable(),
        dueAt: z.number().int().optional().nullable(),
        notes: z.string().max(2000).optional().nullable(),
        lines: z
          .array(
            z.object({
              stockItemId: z.number().int().positive(),
              qty: z.number().positive(),
              unitCostKop: z.number().int().min(0),
              expiresAt: z.number().int().optional().nullable(),
              lotCode: z.string().max(64).optional().nullable(),
            }),
          )
          .min(1),
      }),
    ),
    (c) => {
      const p = c.req.valid('json')
      if (!db.prepare(`SELECT id FROM suppliers WHERE id=?`).get(p.supplierId)) throw bad('Поставщик не найден', 404)
      const t = now()
      const total = p.lines.reduce((s, l) => s + Math.round(l.qty * l.unitCostKop), 0)
      const id = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO purchase_invoices(supplier_id, store_uuid, number, status, total_kop, paid_kop, due_at, notes, created_at, updated_at)
             VALUES(?,?,?,'draft',?,0,?,?,?,?)`,
          )
          .run(p.supplierId, p.storeUuid ?? null, p.number ?? null, total, p.dueAt ?? null, p.notes ?? null, t, t)
        const invoiceId = Number(info.lastInsertRowid)
        const ins = db.prepare(
          `INSERT INTO purchase_invoice_lines(invoice_id, stock_item_id, qty, unit_cost_kop, expires_at, lot_code)
           VALUES(?,?,?,?,?,?)`,
        )
        for (const l of p.lines) {
          if (!db.prepare(`SELECT id FROM stock_items WHERE id=?`).get(l.stockItemId)) throw bad(`Позиция склада ${l.stockItemId} не найдена`, 404)
          ins.run(invoiceId, l.stockItemId, l.qty, l.unitCostKop, l.expiresAt ?? null, l.lotCode ?? null)
        }
        return invoiceId
      })()
      return c.json({ id }, 201)
    },
  )

  /** Post invoice: create batches + movements, status=posted. Draft does not move stock (audit). */
  .post('/purchases/invoices/:id/post', (c) => {
    const id = Number(c.req.param('id'))
    const inv = db
      .prepare(`SELECT id, status, supplier_id AS supplierId, store_uuid AS storeUuid FROM purchase_invoices WHERE id=?`)
      .get(id) as { id: number; status: string; supplierId: number; storeUuid: string | null } | undefined
    if (!inv) throw bad('Накладная не найдена', 404)
    if (inv.status !== 'draft') throw bad('Провести можно только черновик', 400)
    const lines = db
      .prepare(
        `SELECT id, stock_item_id AS stockItemId, qty, unit_cost_kop AS unitCostKop, expires_at AS expiresAt, lot_code AS lotCode
         FROM purchase_invoice_lines WHERE invoice_id=?`,
      )
      .all(id) as {
        id: number
        stockItemId: number
        qty: number
        unitCostKop: number
        expiresAt: number | null
        lotCode: string | null
      }[]
    if (!lines.length) throw bad('Нет строк накладной', 400)
    const t = now()
    db.transaction(() => {
      for (const l of lines) {
        const b = db
          .prepare(
            `INSERT INTO stock_batches(stock_item_id, store_uuid, lot_code, qty_in, qty_left, unit_cost_kop, expires_at, supplier_id, source_type, source_id, created_at)
             VALUES(?,?,?,?,?,?,?,?,'purchase',?,?)`,
          )
          .run(
            l.stockItemId,
            inv.storeUuid,
            l.lotCode,
            l.qty,
            l.qty,
            l.unitCostKop,
            l.expiresAt,
            inv.supplierId,
            id,
            t,
          )
        const batchId = Number(b.lastInsertRowid)
        db.prepare(`UPDATE purchase_invoice_lines SET batch_id=? WHERE id=?`).run(batchId, l.id)
        db.prepare(
          `INSERT INTO stock_movements(stock_item_id, batch_id, store_uuid, qty, kind, doc_type, doc_id, note, created_at)
           VALUES(?,?,?,?,'purchase_in','purchase_invoice',?,?,?)`,
        ).run(l.stockItemId, batchId, inv.storeUuid, l.qty, id, 'Приход по накладной', t)
      }
      db.prepare(`UPDATE purchase_invoices SET status='posted', posted_at=?, updated_at=? WHERE id=?`).run(t, t, id)
    })()
    return c.json({ ok: true, postedAt: t })
  })

  .delete('/purchases/invoices/:id', (c) => {
    const id = Number(c.req.param('id'))
    const inv = db.prepare(`SELECT status FROM purchase_invoices WHERE id=?`).get(id) as { status: string } | undefined
    if (!inv) throw bad('Накладная не найдена', 404)
    if (inv.status === 'posted') throw bad('Проведённую накладную нельзя удалить', 400)
    db.prepare(`DELETE FROM purchase_invoices WHERE id=?`).run(id)
    return c.json({ ok: true })
  })

  /* ───── Payments (must allocate to invoices — audit) ───── */
  .post(
    '/purchases/payments',
    zValidator(
      'json',
      z.object({
        supplierId: z.number().int().positive(),
        amountKop: z.number().int().positive(),
        paidAt: z.number().int().optional(),
        notes: z.string().max(2000).optional().nullable(),
        allocations: z
          .array(z.object({ invoiceId: z.number().int().positive(), amountKop: z.number().int().positive() }))
          .min(1),
      }),
    ),
    (c) => {
      const p = c.req.valid('json')
      const sumAlloc = p.allocations.reduce((s, a) => s + a.amountKop, 0)
      if (sumAlloc !== p.amountKop) throw bad('Сумма распределения должна равняться сумме оплаты', 400)
      if (!db.prepare(`SELECT id FROM suppliers WHERE id=?`).get(p.supplierId)) throw bad('Поставщик не найден', 404)
      const t = p.paidAt ?? now()
      const paymentId = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO purchase_payments(supplier_id, amount_kop, paid_at, notes, created_at) VALUES(?,?,?,?,?)`,
          )
          .run(p.supplierId, p.amountKop, t, p.notes ?? null, now())
        const pid = Number(info.lastInsertRowid)
        const ins = db.prepare(
          `INSERT INTO purchase_payment_alloc(payment_id, invoice_id, amount_kop) VALUES(?,?,?)`,
        )
        for (const a of p.allocations) {
          const inv = db
            .prepare(`SELECT id, status, supplier_id, total_kop, paid_kop FROM purchase_invoices WHERE id=?`)
            .get(a.invoiceId) as
            | { id: number; status: string; supplier_id: number; total_kop: number; paid_kop: number }
            | undefined
          if (!inv) throw bad(`Накладная ${a.invoiceId} не найдена`, 404)
          if (inv.supplier_id !== p.supplierId) throw bad('Накладная другого поставщика', 400)
          if (inv.status !== 'posted') throw bad('Оплата только по проведённым накладным', 400)
          ins.run(pid, a.invoiceId, a.amountKop)
          db.prepare(`UPDATE purchase_invoices SET paid_kop = paid_kop + ?, updated_at=? WHERE id=?`).run(
            a.amountKop,
            now(),
            a.invoiceId,
          )
        }
        return pid
      })()
      return c.json({ id: paymentId }, 201)
    },
  )

  .get('/purchases/debt', (c) => {
    const rows = db
      .prepare(
        `SELECT s.id AS supplierId, s.name AS supplierName,
                COALESCE(SUM(CASE WHEN i.status='posted' THEN i.total_kop - i.paid_kop ELSE 0 END),0) AS debtKop,
                COUNT(CASE WHEN i.status='posted' AND i.paid_kop < i.total_kop THEN 1 END) AS openInvoices
         FROM suppliers s
         LEFT JOIN purchase_invoices i ON i.supplier_id = s.id
         WHERE s.active=1
         GROUP BY s.id
         HAVING debtKop > 0
         ORDER BY debtKop DESC`,
      )
      .all()
    return c.json({ debts: rows })
  })

  /* ───── Inventory docs ───── */
  .get('/inventory', (c) => {
    const rows = db
      .prepare(
        `SELECT id, store_uuid AS storeUuid, kind, status, notes,
                created_at AS createdAt, updated_at AS updatedAt, posted_at AS postedAt
         FROM inventory_docs ORDER BY id DESC LIMIT 100`,
      )
      .all()
    return c.json({ docs: rows })
  })

  .post(
    '/inventory',
    zValidator(
      'json',
      z.object({
        storeUuid: z.string().max(64).optional().nullable(),
        kind: z.enum(['full', 'partial']),
        notes: z.string().max(2000).optional().nullable(),
        stockItemIds: z.array(z.number().int().positive()).optional(),
      }),
    ),
    (c) => {
      const p = c.req.valid('json')
      if (p.kind === 'partial' && !(p.stockItemIds && p.stockItemIds.length)) {
        throw bad('Для частичной инвентаризации выберите позиции', 400)
      }
      const t = now()
      const id = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO inventory_docs(store_uuid, kind, status, notes, created_at, updated_at)
             VALUES(?,?,'draft',?,?,?)`,
          )
          .run(p.storeUuid ?? null, p.kind, p.notes ?? null, t, t)
        const docId = Number(info.lastInsertRowid)
        let itemIds = p.stockItemIds
        if (p.kind === 'full') {
          itemIds = (
            db.prepare(`SELECT id FROM stock_items WHERE active=1`).all() as { id: number }[]
          ).map((r) => r.id)
        }
        const ins = db.prepare(
          `INSERT INTO inventory_lines(doc_id, stock_item_id, book_qty, fact_qty, unit_cost_kop) VALUES(?,?,?,?,0)`,
        )
        for (const sid of itemIds ?? []) {
          const book = expectedQty(sid, p.storeUuid ?? null)
          ins.run(docId, sid, book, null)
        }
        return docId
      })()
      return c.json({ id }, 201)
    },
  )

  .get('/inventory/:id', (c) => {
    const id = Number(c.req.param('id'))
    const doc = db
      .prepare(
        `SELECT id, store_uuid AS storeUuid, kind, status, notes,
                created_at AS createdAt, updated_at AS updatedAt, posted_at AS postedAt
         FROM inventory_docs WHERE id=?`,
      )
      .get(id) as Record<string, unknown> | undefined
    if (!doc) throw bad('Документ не найден', 404)
    const lines = db
      .prepare(
        `SELECT l.id, l.stock_item_id AS stockItemId, i.name AS itemName, i.unit,
                l.book_qty AS bookQty, l.fact_qty AS factQty, l.unit_cost_kop AS unitCostKop
         FROM inventory_lines l
         JOIN stock_items i ON i.id = l.stock_item_id
         WHERE l.doc_id=?
         ORDER BY i.name COLLATE NOCASE`,
      )
      .all(id)
    return c.json({ doc, lines })
  })

  .patch(
    '/inventory/:id/lines',
    zValidator(
      'json',
      z.object({
        lines: z.array(
          z.object({
            stockItemId: z.number().int().positive(),
            factQty: z.number().min(0),
          }),
        ),
      }),
    ),
    (c) => {
      const id = Number(c.req.param('id'))
      const doc = db.prepare(`SELECT status FROM inventory_docs WHERE id=?`).get(id) as { status: string } | undefined
      if (!doc) throw bad('Документ не найден', 404)
      if (doc.status === 'posted' || doc.status === 'cancelled') throw bad('Документ закрыт', 400)
      const p = c.req.valid('json')
      const upd = db.prepare(
        `UPDATE inventory_lines SET fact_qty=? WHERE doc_id=? AND stock_item_id=?`,
      )
      db.transaction(() => {
        for (const l of p.lines) upd.run(l.factQty, id, l.stockItemId)
        db.prepare(`UPDATE inventory_docs SET status='counting', updated_at=? WHERE id=?`).run(now(), id)
      })()
      return c.json({ ok: true })
    },
  )

  .post('/inventory/:id/post', (c) => {
    const id = Number(c.req.param('id'))
    const doc = db
      .prepare(`SELECT id, status, store_uuid AS storeUuid FROM inventory_docs WHERE id=?`)
      .get(id) as { id: number; status: string; storeUuid: string | null } | undefined
    if (!doc) throw bad('Документ не найден', 404)
    if (doc.status === 'posted') throw bad('Уже проведена', 400)
    const lines = db
      .prepare(
        `SELECT stock_item_id AS stockItemId, book_qty AS bookQty, fact_qty AS factQty
         FROM inventory_lines WHERE doc_id=?`,
      )
      .all(id) as { stockItemId: number; bookQty: number | null; factQty: number | null }[]
    if (lines.some((l) => l.factQty == null)) throw bad('Заполните факт по всем строкам', 400)
    const t = now()
    db.transaction(() => {
      for (const l of lines) {
        const book = l.bookQty ?? 0
        const fact = l.factQty ?? 0
        const delta = fact - book
        if (delta === 0) continue
        db.prepare(
          `INSERT INTO stock_movements(stock_item_id, batch_id, store_uuid, qty, kind, doc_type, doc_id, note, created_at)
           VALUES(?,NULL,?,?,'inventory_adj','inventory',?,?,?)`,
        ).run(l.stockItemId, doc.storeUuid, delta, id, 'Инвентаризация', t)
        // Adjust FEFO batches roughly: if positive, create adjustment batch; if negative, consume
        if (delta > 0) {
          db.prepare(
            `INSERT INTO stock_batches(stock_item_id, store_uuid, lot_code, qty_in, qty_left, unit_cost_kop, expires_at, source_type, source_id, created_at)
             VALUES(?,?,NULL,?,?,0,NULL,'inventory',?,?)`,
          ).run(l.stockItemId, doc.storeUuid, delta, delta, id, t)
        } else {
          let need = -delta
          const batches = db
            .prepare(
              `SELECT id, qty_left FROM stock_batches
               WHERE stock_item_id=? AND qty_left>0
               ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC`,
            )
            .all(l.stockItemId) as { id: number; qty_left: number }[]
          for (const b of batches) {
            if (need <= 0) break
            const take = Math.min(b.qty_left, need)
            db.prepare(`UPDATE stock_batches SET qty_left = qty_left - ? WHERE id=?`).run(take, b.id)
            need -= take
          }
        }
      }
      db.prepare(`UPDATE inventory_docs SET status='posted', posted_at=?, updated_at=? WHERE id=?`).run(t, t, id)
    })()
    return c.json({ ok: true, postedAt: t })
  })
