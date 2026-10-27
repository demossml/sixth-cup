/**
 * "Studio" API — everything the audit UI (coffee.html) needs on top of the existing admin API.
 * ADDITIVE ONLY: no existing route/contract is touched. Mounted into adminRoutes (same X-Admin-Token auth/roles).
 *
 *  purchases : /purchases/snapshot, /purchases/payments, orders, returns, reconciliations, bank rows, order-helper
 *  suppliers : PATCH /suppliers/:id/legal
 *  stock     : /stock/recipes, /stock/snapshot, inventory zones / recount / cancel / submit
 *  ai        : /ai/feed (rule-based, from real data), hide, payment draft
 *  analytics : /analytics/overview, heatmap, staff, affinity, customers, compare
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { toCsv } from './consoleLib'
import { assertNormSane } from './stock'

const now = () => Date.now()
const DAY = 86_400_000

type Row = Record<string, unknown>
const all = <T = Row>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as T[]
const one = <T = Row>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as T | undefined
const idParam = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw bad('Invalid id', 400)
  return n
}

function stockQty(itemId: number, storeUuid?: string | null): number {
  const r = storeUuid
    ? one<{ q: number }>(`SELECT COALESCE(SUM(qty),0) q FROM stock_movements WHERE stock_item_id=? AND store_uuid=?`, itemId, storeUuid)
    : one<{ q: number }>(`SELECT COALESCE(SUM(qty),0) q FROM stock_movements WHERE stock_item_id=?`, itemId)
  return Number(r?.q) || 0
}

/* ───────── purchase domain helpers ───────── */

function supplierRows() {
  return all(
    `SELECT id, name, inn, contact, phone, email, bank_details AS bankDetails,
            payment_delay_days AS paymentDelayDays, notes, active,
            legal_name AS legalName, legal_type AS legalType, kpp, ogrn,
            legal_addr AS legalAddr, delivery_addr AS deliveryAddr, extra_json AS extraJson,
            created_at AS createdAt, updated_at AS updatedAt
     FROM suppliers ORDER BY name COLLATE NOCASE`,
  ).map((r) => {
    let extra: unknown = {}
    try { extra = r.extraJson ? JSON.parse(String(r.extraJson)) : {} } catch { extra = {} }
    const { extraJson: _x, ...rest } = r
    return { ...rest, extra }
  })
}

function invoiceRows() {
  const inv = all(
    `SELECT i.id, i.supplier_id AS supplierId, i.store_uuid AS storeUuid, i.number, i.status,
            i.total_kop AS totalKop, i.paid_kop AS paidKop, i.due_at AS dueAt, i.posted_at AS postedAt,
            i.received_at AS receivedAt, i.notes, i.created_at AS createdAt, i.updated_at AS updatedAt,
            st.name AS storeName
     FROM purchase_invoices i LEFT JOIN evotor_stores st ON st.store_uuid = i.store_uuid
     ORDER BY i.id DESC LIMIT 500`,
  )
  const lines = all<{ invoiceId: number }>(
    `SELECT l.invoice_id AS invoiceId, l.stock_item_id AS stockItemId, l.qty, l.unit_cost_kop AS unitCostKop,
            l.expires_at AS expiresAt, l.lot_code AS lotCode
     FROM purchase_invoice_lines l`,
  )
  const by = new Map<number, Row[]>()
  for (const l of lines) (by.get(l.invoiceId) ?? by.set(l.invoiceId, []).get(l.invoiceId)!).push(l as unknown as Row)
  return inv.map((i) => ({ ...i, lines: by.get(Number(i.id)) ?? [] }))
}

function paymentRows() {
  const pays = all(
    `SELECT id, supplier_id AS supplierId, amount_kop AS amountKop, paid_at AS paidAt, notes, created_at AS createdAt
     FROM purchase_payments ORDER BY id DESC LIMIT 500`,
  )
  const al = all<{ paymentId: number }>(
    `SELECT payment_id AS paymentId, invoice_id AS invoiceId, amount_kop AS amountKop FROM purchase_payment_alloc`,
  )
  const by = new Map<number, Row[]>()
  for (const a of al) (by.get(a.paymentId) ?? by.set(a.paymentId, []).get(a.paymentId)!).push(a as unknown as Row)
  return pays.map((p) => ({ ...p, allocations: by.get(Number(p.id)) ?? [] }))
}

function orderRows() {
  const os = all(
    `SELECT id, supplier_id AS supplierId, store_uuid AS storeUuid, status, delivery_at AS deliveryAt, notes,
            created_at AS createdAt, updated_at AS updatedAt FROM purchase_orders ORDER BY id DESC LIMIT 300`,
  )
  const ls = all<{ orderId: number }>(
    `SELECT order_id AS orderId, id AS lineId, stock_item_id AS stockItemId, qty, price_kop AS priceKop, received_qty AS receivedQty
     FROM purchase_order_lines`,
  )
  const by = new Map<number, Row[]>()
  for (const l of ls) (by.get(l.orderId) ?? by.set(l.orderId, []).get(l.orderId)!).push(l as unknown as Row)
  return os.map((o) => ({ ...o, lines: by.get(Number(o.id)) ?? [] }))
}

function returnRows() {
  const rs = all(
    `SELECT id, supplier_id AS supplierId, store_uuid AS storeUuid, basis, status, notes, posted_at AS postedAt,
            created_at AS createdAt, updated_at AS updatedAt FROM supplier_returns ORDER BY id DESC LIMIT 300`,
  )
  const ls = all<{ returnId: number }>(
    `SELECT return_id AS returnId, stock_item_id AS stockItemId, qty, price_kop AS priceKop FROM supplier_return_lines`,
  )
  const by = new Map<number, Row[]>()
  for (const l of ls) (by.get(l.returnId) ?? by.set(l.returnId, []).get(l.returnId)!).push(l as unknown as Row)
  return rs.map((r) => ({ ...r, lines: by.get(Number(r.id)) ?? [] }))
}

/** Reconciliation figures are computed from real documents, never stored. */
function reconRows() {
  const rs = all<{
    id: number; supplierId: number; periodFrom: number; periodTo: number
    theirBalanceKop: number | null; status: string; notes: string | null
  }>(
    `SELECT id, supplier_id AS supplierId, period_from AS periodFrom, period_to AS periodTo,
            their_balance_kop AS theirBalanceKop, status, notes, created_at AS createdAt, updated_at AS updatedAt
     FROM supplier_reconciliations ORDER BY id DESC LIMIT 300`,
  )
  return rs.map((r) => {
    const turnover = one<{ s: number }>(
      `SELECT COALESCE(SUM(total_kop),0) s FROM purchase_invoices
       WHERE supplier_id=? AND status='posted' AND COALESCE(posted_at,created_at) BETWEEN ? AND ?`,
      r.supplierId, r.periodFrom, r.periodTo,
    )?.s ?? 0
    const paid = one<{ s: number }>(
      `SELECT COALESCE(SUM(amount_kop),0) s FROM purchase_payments WHERE supplier_id=? AND paid_at BETWEEN ? AND ?`,
      r.supplierId, r.periodFrom, r.periodTo,
    )?.s ?? 0
    const ourBalanceKop = Number(turnover) - Number(paid)
    return { ...r, turnoverKop: Number(turnover), paidKop: Number(paid), ourBalanceKop, diffKop: r.theirBalanceKop == null ? null : r.theirBalanceKop - ourBalanceKop }
  })
}

function bankRows() {
  return all(
    `SELECT b.id, b.date_at AS dateAt, b.party, b.purpose, b.amount_kop AS amountKop,
            b.supplier_id AS supplierId, b.invoice_id AS invoiceId, i.number AS invoiceNumber,
            b.payment_id AS paymentId, s.name AS supplierName
     FROM bank_rows b
     LEFT JOIN purchase_invoices i ON i.id = b.invoice_id
     LEFT JOIN suppliers s ON s.id = b.supplier_id
     ORDER BY b.date_at DESC, b.id DESC LIMIT 500`,
  ).map((r) => ({ ...r, matched: r.invoiceId != null, paid: r.paymentId != null }))
}

/* ───────── AI feed (rule based on real data) ───────── */

type AiCard = {
  key: string
  sev: 'urgent' | 'warn' | 'info' | 'good'
  title: string
  why: string
  primary: Row
  secondary?: Row
}

const rub = (kop: number) => `${Math.round(kop / 100).toLocaleString('ru-RU')} ₽`

function buildAiFeed(): AiCard[] {
  const t = now()
  const cards: AiCard[] = []
  // overdue invoices
  for (const i of all<{ id: number; number: string | null; name: string; due: number; debt: number }>(
    `SELECT i.id, i.number, s.name, i.due_at AS due, i.total_kop - i.paid_kop AS debt
     FROM purchase_invoices i JOIN suppliers s ON s.id=i.supplier_id
     WHERE i.status='posted' AND i.paid_kop < i.total_kop AND i.due_at IS NOT NULL AND i.due_at < ?
     ORDER BY i.due_at ASC LIMIT 5`, t)) {
    cards.push({
      key: `pay-${i.id}`, sev: 'urgent', title: `Накладная ${i.number || '№' + i.id} просрочена`,
      why: `${i.name} · ${rub(i.debt)} · срок ${new Date(i.due).toLocaleDateString('ru-RU')}`,
      primary: { label: 'Создать оплату', action: 'draft-pay', invoiceId: i.id },
      secondary: { label: 'Накладные', nav: 'purchases' },
    })
  }
  // low stock
  const low = all<{ id: number; name: string; unit: string; minQty: number }>(
    `SELECT id, name, unit, min_qty AS minQty FROM stock_items WHERE active=1 AND min_qty>0`)
    .map((i) => ({ ...i, q: stockQty(i.id) })).filter((i) => i.q < i.minQty)
  for (const i of low.slice(0, 5)) {
    cards.push({
      key: `stock-${i.id}`, sev: i.q <= 0 ? 'urgent' : 'warn', title: `${i.name}: остаток ниже минимума`,
      why: `Остаток ${Math.round(i.q * 100) / 100} ${i.unit}, минимум ${i.minQty} ${i.unit}`,
      primary: { label: 'Заказать', action: 'order-helper', stockItemId: i.id },
      secondary: { label: 'Остатки', nav: 'stock' },
    })
  }
  // expiring batches
  const exp = one<{ n: number }>(
    `SELECT COUNT(*) n FROM stock_batches WHERE qty_left>0 AND expires_at IS NOT NULL AND expires_at <= ?`, t + 3 * DAY)?.n ?? 0
  if (exp > 0) cards.push({
    key: 'expiry', sev: 'warn', title: `${exp} партий истекают в ближайшие 3 дня`, why: 'Спишите или продайте по FEFO',
    primary: { label: 'Сроки годности', nav: 'expiry' },
  })
  // products without norms
  const nn = one<{ n: number }>(
    `SELECT COUNT(*) n FROM products p WHERE p.available=1 AND NOT EXISTS (SELECT 1 FROM product_stock_norms n WHERE n.product_id=p.id)
       AND NOT EXISTS (SELECT 1 FROM product_recipe_modes m WHERE m.product_id=p.id AND m.mode='none')`)?.n ?? 0
  if (nn > 0) cards.push({
    key: 'no-norm', sev: 'warn', title: `${nn} поз. без нормы`, why: 'Списание по продажам для них не работает',
    primary: { label: 'Заполнить нормы', action: 'stock-recipes-none' }, secondary: { label: 'Нормы', nav: 'stock' },
  })
  // products without photo
  const np = one<{ n: number }>(`SELECT COUNT(*) n FROM products WHERE available=1 AND (image_url IS NULL OR image_url='')`)?.n
  if (np && np > 0) cards.push({
    key: 'no-photo', sev: 'info', title: `${np} товаров без фото`, why: 'В PWA покажется серая заглушка',
    primary: { label: 'Открыть без фото', action: 'menu-no-photo' }, secondary: { label: 'Меню', nav: 'menu' },
  })
  // sales without a loyalty card (last 24h)
  const sd = one<{ n: number }>(`SELECT COUNT(*) n FROM evotor_docs WHERE type='SELL' AND received_at>=?`, t - DAY)?.n ?? 0
  const sc = one<{ n: number }>(`SELECT COUNT(*) n FROM loyalty_ops WHERE kind='SELL' AND created_at>=?`, t - DAY)?.n ?? 0
  if (sd - sc > 0) cards.push({
    key: 'no-card', sev: 'info', title: `${sd - sc} продаж без карты`, why: `${sd ? Math.round(((sd - sc) / sd) * 1000) / 10 : 0}% чеков за 24 часа · чашки не начислены`,
    primary: { label: 'Открыть операции', action: 'operations-nocard' }, secondary: { label: 'Аналитика', nav: 'analytics' },
  })
  // hide
  const hidden = new Set(all<{ card_key: string }>(`SELECT card_key FROM ai_card_hidden WHERE hidden_until > ?`, t).map((r) => r.card_key))
  return cards.filter((c) => !hidden.has(c.key))
}

/* ───────── analytics helpers ───────── */

function periodRange(period: string | undefined): { since: number; until: number } {
  const until = now()
  if (period === 'yesterday') {
    const d = new Date(until); d.setHours(0, 0, 0, 0)
    return { since: d.getTime() - DAY, until: d.getTime() }
  }
  const days = period === '24h' || period === 'today' ? 1 : period === '7d' ? 7 : period === '90d' ? 90 : period === '365d' ? 365 : 30
  return { since: until - days * DAY, until }
}

const hasCol = (table: string, col: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col)

export const adminStudio = new Hono()

  /* ═════════ PURCHASES: snapshot (one call for the whole screen) ═════════ */
  .get('/purchases/snapshot', (c) => {
    return c.json({
      suppliers: supplierRows(),
      invoices: invoiceRows(),
      payments: paymentRows(),
      orders: orderRows(),
      returns: returnRows(),
      reconciliations: reconRows(),
      bankRows: bankRows(),
      stockItems: all(`SELECT id, name, unit, kind, min_qty AS minQty, default_supplier_id AS defaultSupplierId FROM stock_items WHERE active=1 ORDER BY name COLLATE NOCASE`),
      generatedAt: now(),
    })
  })

  .get('/purchases/payments', (c) => c.json({ payments: paymentRows() }))

  /** Mark invoice as physically received / not (audit «принята»). Does not move stock — posting does. */
  .post('/purchases/invoices/:id/receive', (c) => {
    const id = idParam(c.req.param('id'))
    if (!one(`SELECT id FROM purchase_invoices WHERE id=?`, id)) throw bad('Накладная не найдена', 404)
    db.prepare(`UPDATE purchase_invoices SET received_at=?, updated_at=? WHERE id=?`).run(now(), now(), id)
    return c.json({ ok: true })
  })

  /* supplier legal details (separate route: the old PATCH /suppliers/:id contract stays untouched) */
  .patch(
    '/suppliers/:id/legal',
    zValidator('json', z.object({
      legalName: z.string().max(300).nullable().optional(),
      legalType: z.string().max(40).nullable().optional(),
      kpp: z.string().max(20).nullable().optional(),
      ogrn: z.string().max(20).nullable().optional(),
      legalAddr: z.string().max(500).nullable().optional(),
      deliveryAddr: z.string().max(500).nullable().optional(),
      extra: z.record(z.unknown()).optional(),
    })),
    (c) => {
      const id = idParam(c.req.param('id'))
      const cur = one<Row>(`SELECT * FROM suppliers WHERE id=?`, id)
      if (!cur) throw bad('Поставщик не найден', 404)
      const p = c.req.valid('json')
      db.prepare(
        `UPDATE suppliers SET legal_name=?, legal_type=?, kpp=?, ogrn=?, legal_addr=?, delivery_addr=?, extra_json=?, updated_at=? WHERE id=?`,
      ).run(
        p.legalName !== undefined ? p.legalName : cur.legal_name,
        p.legalType !== undefined ? p.legalType : cur.legal_type,
        p.kpp !== undefined ? p.kpp : cur.kpp,
        p.ogrn !== undefined ? p.ogrn : cur.ogrn,
        p.legalAddr !== undefined ? p.legalAddr : cur.legal_addr,
        p.deliveryAddr !== undefined ? p.deliveryAddr : cur.delivery_addr,
        p.extra !== undefined ? JSON.stringify(p.extra) : cur.extra_json,
        now(), id,
      )
      return c.json({ ok: true })
    },
  )

  /* ═════════ PURCHASE ORDERS ═════════ */
  .get('/purchases/orders', (c) => c.json({ orders: orderRows() }))

  .post(
    '/purchases/orders',
    zValidator('json', z.object({
      supplierId: z.number().int().positive(),
      storeUuid: z.string().max(64).nullable().optional(),
      deliveryAt: z.number().int().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      lines: z.array(z.object({
        stockItemId: z.number().int().positive(),
        qty: z.number().positive(),
        priceKop: z.number().int().min(0),
      })).min(1),
    })),
    (c) => {
      const p = c.req.valid('json')
      if (!one(`SELECT id FROM suppliers WHERE id=?`, p.supplierId)) throw bad('Поставщик не найден', 404)
      const t = now()
      const id = db.transaction(() => {
        const info = db.prepare(
          `INSERT INTO purchase_orders(supplier_id, store_uuid, status, delivery_at, notes, created_at, updated_at) VALUES(?,?, 'draft',?,?,?,?)`,
        ).run(p.supplierId, p.storeUuid ?? null, p.deliveryAt ?? null, p.notes ?? null, t, t)
        const oid = Number(info.lastInsertRowid)
        const ins = db.prepare(`INSERT INTO purchase_order_lines(order_id, stock_item_id, qty, price_kop) VALUES(?,?,?,?)`)
        for (const l of p.lines) {
          if (!one(`SELECT id FROM stock_items WHERE id=?`, l.stockItemId)) throw bad(`Позиция ${l.stockItemId} не найдена`, 404)
          ins.run(oid, l.stockItemId, l.qty, l.priceKop)
        }
        return oid
      })()
      return c.json({ id }, 201)
    },
  )

  .patch(
    '/purchases/orders/:id',
    zValidator('json', z.object({
      status: z.enum(['draft', 'confirmed', 'sent', 'partial', 'closed']).optional(),
      deliveryAt: z.number().int().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      lines: z.array(z.object({
        stockItemId: z.number().int().positive(),
        qty: z.number().positive(),
        priceKop: z.number().int().min(0),
        receivedQty: z.number().min(0).optional(),
      })).min(1).optional(),
    })),
    (c) => {
      const id = idParam(c.req.param('id'))
      const cur = one<{ status: string }>(`SELECT status FROM purchase_orders WHERE id=?`, id)
      if (!cur) throw bad('Заказ не найден', 404)
      const p = c.req.valid('json')
      if (p.lines && cur.status !== 'draft') throw bad('Строки можно менять только в черновике', 400)
      db.transaction(() => {
        db.prepare(
          `UPDATE purchase_orders SET status=COALESCE(?,status), delivery_at=CASE WHEN ? THEN ? ELSE delivery_at END,
           notes=CASE WHEN ? THEN ? ELSE notes END, updated_at=? WHERE id=?`,
        ).run(p.status ?? null, p.deliveryAt !== undefined ? 1 : 0, p.deliveryAt ?? null, p.notes !== undefined ? 1 : 0, p.notes ?? null, now(), id)
        if (p.lines) {
          db.prepare(`DELETE FROM purchase_order_lines WHERE order_id=?`).run(id)
          const ins = db.prepare(`INSERT INTO purchase_order_lines(order_id, stock_item_id, qty, price_kop, received_qty) VALUES(?,?,?,?,?)`)
          for (const l of p.lines) ins.run(id, l.stockItemId, l.qty, l.priceKop, l.receivedQty ?? 0)
        }
      })()
      return c.json({ ok: true })
    },
  )

  .delete('/purchases/orders/:id', (c) => {
    const id = idParam(c.req.param('id'))
    const cur = one<{ status: string }>(`SELECT status FROM purchase_orders WHERE id=?`, id)
    if (!cur) throw bad('Заказ не найден', 404)
    if (cur.status !== 'draft') throw bad('Удалить можно только черновик', 400)
    db.prepare(`DELETE FROM purchase_orders WHERE id=?`).run(id)
    return c.json({ ok: true })
  })

  /** Order → draft purchase invoice (creates the document the warehouse will post). */
  .post('/purchases/orders/:id/to-invoice', (c) => {
    const id = idParam(c.req.param('id'))
    const o = one<{ supplier_id: number; store_uuid: string | null; status: string }>(`SELECT * FROM purchase_orders WHERE id=?`, id)
    if (!o) throw bad('Заказ не найден', 404)
    if (o.status === 'draft') throw bad('Сначала подтвердите заказ', 400)
    const ls = all<{ stock_item_id: number; qty: number; price_kop: number; received_qty: number }>(
      `SELECT * FROM purchase_order_lines WHERE order_id=?`, id,
    ).map((l) => ({ ...l, rest: l.qty - l.received_qty })).filter((l) => l.rest > 0)
    if (!ls.length) throw bad('Заказ уже принят полностью', 400)
    const t = now()
    const invId = db.transaction(() => {
      const total = ls.reduce((s, l) => s + Math.round(l.rest * l.price_kop), 0)
      const info = db.prepare(
        `INSERT INTO purchase_invoices(supplier_id, store_uuid, number, status, total_kop, paid_kop, notes, created_at, updated_at)
         VALUES(?,?,?,'draft',?,0,?,?,?)`,
      ).run(o.supplier_id, o.store_uuid, `ЗК-${id}`, total, `По заказу ЗК-${id}`, t, t)
      const iid = Number(info.lastInsertRowid)
      const ins = db.prepare(`INSERT INTO purchase_invoice_lines(invoice_id, stock_item_id, qty, unit_cost_kop) VALUES(?,?,?,?)`)
      for (const l of ls) ins.run(iid, l.stock_item_id, l.rest, l.price_kop)
      db.prepare(`UPDATE purchase_order_lines SET received_qty = qty WHERE order_id=?`).run(id)
      db.prepare(`UPDATE purchase_orders SET status='closed', updated_at=? WHERE id=?`).run(t, id)
      return iid
    })()
    return c.json({ invoiceId: invId }, 201)
  })

  /** Order helper: suggest quantities from min stock + 7-day sales × norms. */
  .get('/purchases/order-helper', (c) => {
    const horizon = Math.min(30, Math.max(1, Number(c.req.query('horizon') || 7)))
    const storeUuid = c.req.query('storeUuid') || null
    const since = now() - 14 * DAY
    const items = all<{ id: number; name: string; unit: string; minQty: number; multiplicity: number; supplierId: number | null }>(
      `SELECT id, name, unit, min_qty AS minQty, multiplicity, default_supplier_id AS supplierId FROM stock_items WHERE active=1`)
    const out = items.map((it) => {
      const sold = one<{ q: number }>(
        `SELECT COALESCE(SUM(-qty),0) q FROM stock_movements WHERE stock_item_id=? AND kind='sale_out' AND created_at>=?`, it.id, since)?.q ?? 0
      const perDay = Number(sold) / 14
      const have = stockQty(it.id, storeUuid)
      const need = Math.max(0, perDay * horizon + it.minQty - have)
      const m = it.multiplicity > 0 ? it.multiplicity : 1
      const qty = need > 0 ? Math.ceil(need / m) * m : 0
      const price = one<{ p: number }>(
        `SELECT unit_cost_kop p FROM purchase_invoice_lines WHERE stock_item_id=? ORDER BY id DESC LIMIT 1`, it.id)?.p ?? 0
      return { ...it, perDay, have, suggestQty: Math.round(qty * 100) / 100, priceKop: Number(price) }
    }).filter((x) => x.suggestQty > 0)
    return c.json({ horizon, items: out })
  })

  /* ═════════ SUPPLIER RETURNS ═════════ */
  .get('/purchases/returns', (c) => c.json({ returns: returnRows() }))

  .post(
    '/purchases/returns',
    zValidator('json', z.object({
      supplierId: z.number().int().positive(),
      storeUuid: z.string().max(64).nullable().optional(),
      basis: z.enum(['Брак', 'Срок', 'Пересорт', 'Прочее']).default('Брак'),
      notes: z.string().max(2000).nullable().optional(),
      lines: z.array(z.object({ stockItemId: z.number().int().positive(), qty: z.number().positive(), priceKop: z.number().int().min(0) })).min(1),
    })),
    (c) => {
      const p = c.req.valid('json')
      if (!one(`SELECT id FROM suppliers WHERE id=?`, p.supplierId)) throw bad('Поставщик не найден', 404)
      const t = now()
      const id = db.transaction(() => {
        const info = db.prepare(
          `INSERT INTO supplier_returns(supplier_id, store_uuid, basis, status, notes, created_at, updated_at) VALUES(?,?,?,'draft',?,?,?)`,
        ).run(p.supplierId, p.storeUuid ?? null, p.basis, p.notes ?? null, t, t)
        const rid = Number(info.lastInsertRowid)
        const ins = db.prepare(`INSERT INTO supplier_return_lines(return_id, stock_item_id, qty, price_kop) VALUES(?,?,?,?)`)
        for (const l of p.lines) ins.run(rid, l.stockItemId, l.qty, l.priceKop)
        return rid
      })()
      return c.json({ id }, 201)
    },
  )

  .patch(
    '/purchases/returns/:id',
    zValidator('json', z.object({
      status: z.enum(['draft', 'shipped', 'cancelled']).optional(),
      basis: z.enum(['Брак', 'Срок', 'Пересорт', 'Прочее']).optional(),
      notes: z.string().max(2000).nullable().optional(),
      lines: z.array(z.object({ stockItemId: z.number().int().positive(), qty: z.number().positive(), priceKop: z.number().int().min(0) })).min(1).optional(),
    })),
    (c) => {
      const id = idParam(c.req.param('id'))
      const cur = one<{ status: string }>(`SELECT status FROM supplier_returns WHERE id=?`, id)
      if (!cur) throw bad('Возврат не найден', 404)
      if (cur.status === 'posted') throw bad('Проведённый возврат нельзя менять', 400)
      const p = c.req.valid('json')
      db.transaction(() => {
        db.prepare(`UPDATE supplier_returns SET status=COALESCE(?,status), basis=COALESCE(?,basis), notes=CASE WHEN ? THEN ? ELSE notes END, updated_at=? WHERE id=?`)
          .run(p.status ?? null, p.basis ?? null, p.notes !== undefined ? 1 : 0, p.notes ?? null, now(), id)
        if (p.lines) {
          db.prepare(`DELETE FROM supplier_return_lines WHERE return_id=?`).run(id)
          const ins = db.prepare(`INSERT INTO supplier_return_lines(return_id, stock_item_id, qty, price_kop) VALUES(?,?,?,?)`)
          for (const l of p.lines) ins.run(id, l.stockItemId, l.qty, l.priceKop)
        }
      })()
      return c.json({ ok: true })
    },
  )

  /** Post return: write stock out (FEFO) + movement kind 'return'. Reduces debt is NOT automatic (audit: credit note is a separate doc). */
  .post('/purchases/returns/:id/post', (c) => {
    const id = idParam(c.req.param('id'))
    const r = one<{ status: string; store_uuid: string | null }>(`SELECT status, store_uuid FROM supplier_returns WHERE id=?`, id)
    if (!r) throw bad('Возврат не найден', 404)
    if (r.status === 'posted') throw bad('Уже проведён', 400)
    if (r.status === 'cancelled') throw bad('Возврат отменён', 400)
    const ls = all<{ stock_item_id: number; qty: number }>(`SELECT stock_item_id, qty FROM supplier_return_lines WHERE return_id=?`, id)
    if (!ls.length) throw bad('Нет строк', 400)
    const t = now()
    db.transaction(() => {
      for (const l of ls) {
        let left = l.qty
        const batches = all<{ id: number; qty_left: number }>(
          `SELECT id, qty_left FROM stock_batches WHERE stock_item_id=? AND qty_left>0
           ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC`, l.stock_item_id)
        for (const b of batches) {
          if (left <= 0) break
          const take = Math.min(left, b.qty_left)
          db.prepare(`UPDATE stock_batches SET qty_left = qty_left - ? WHERE id=?`).run(take, b.id)
          db.prepare(
            `INSERT INTO stock_movements(stock_item_id, batch_id, store_uuid, qty, kind, doc_type, doc_id, note, created_at)
             VALUES(?,?,?,?,'return','supplier_return',?,?,?)`,
          ).run(l.stock_item_id, b.id, r.store_uuid, -take, id, 'Возврат поставщику', t)
          left -= take
        }
        if (left > 0.0001) {
          // No batches left for the remainder: still book the movement so the ledger stays honest.
          db.prepare(
            `INSERT INTO stock_movements(stock_item_id, batch_id, store_uuid, qty, kind, doc_type, doc_id, note, created_at)
             VALUES(?,NULL,?,?,'return','supplier_return',?,?,?)`,
          ).run(l.stock_item_id, r.store_uuid, -left, id, 'Возврат поставщику (без партии)', t)
        }
      }
      db.prepare(`UPDATE supplier_returns SET status='posted', posted_at=?, updated_at=? WHERE id=?`).run(t, t, id)
    })()
    return c.json({ ok: true, postedAt: t })
  })

  /* ═════════ RECONCILIATIONS ═════════ */
  .get('/purchases/reconciliations', (c) => c.json({ reconciliations: reconRows() }))

  .post(
    '/purchases/reconciliations',
    zValidator('json', z.object({
      supplierId: z.number().int().positive(),
      periodFrom: z.number().int(),
      periodTo: z.number().int(),
      notes: z.string().max(2000).nullable().optional(),
    })),
    (c) => {
      const p = c.req.valid('json')
      if (p.periodTo < p.periodFrom) throw bad('Конец периода раньше начала', 400)
      if (!one(`SELECT id FROM suppliers WHERE id=?`, p.supplierId)) throw bad('Поставщик не найден', 404)
      const t = now()
      const info = db.prepare(
        `INSERT INTO supplier_reconciliations(supplier_id, period_from, period_to, status, notes, created_at, updated_at) VALUES(?,?,?,'draft',?,?,?)`,
      ).run(p.supplierId, p.periodFrom, p.periodTo, p.notes ?? null, t, t)
      return c.json({ id: Number(info.lastInsertRowid) }, 201)
    },
  )

  .patch(
    '/purchases/reconciliations/:id',
    zValidator('json', z.object({
      theirBalanceKop: z.number().int().nullable().optional(),
      status: z.enum(['draft', 'sent', 'agreed', 'mismatch']).optional(),
      notes: z.string().max(2000).nullable().optional(),
    })),
    (c) => {
      const id = idParam(c.req.param('id'))
      if (!one(`SELECT id FROM supplier_reconciliations WHERE id=?`, id)) throw bad('Сверка не найдена', 404)
      const p = c.req.valid('json')
      db.prepare(
        `UPDATE supplier_reconciliations SET their_balance_kop=CASE WHEN ? THEN ? ELSE their_balance_kop END,
         status=COALESCE(?,status), notes=CASE WHEN ? THEN ? ELSE notes END, updated_at=? WHERE id=?`,
      ).run(p.theirBalanceKop !== undefined ? 1 : 0, p.theirBalanceKop ?? null, p.status ?? null, p.notes !== undefined ? 1 : 0, p.notes ?? null, now(), id)
      return c.json({ ok: true })
    },
  )

  /** Удаление сверки: ошибочный период/поставщик нужно уметь убрать, иначе список копится мусором. */
  .delete('/purchases/reconciliations/:id', (c) => {
    const id = idParam(c.req.param('id'))
    if (!one(`SELECT id FROM supplier_reconciliations WHERE id=?`, id)) throw bad('Сверка не найдена', 404)
    db.prepare(`DELETE FROM supplier_reconciliations WHERE id=?`).run(id)
    return c.json({ ok: true })
  })

  /** CSV акта сверки: одна сверка, те же цифры, что в UI (оборот, оплаты, долг, данные поставщика, расхождение). */
  .get('/purchases/reconciliations/:id.csv', (c) => {
    // Hono кладёт параметр шаблона `:id.csv` под ключ `id.csv`, а не `id`.
    const id = idParam((c.req.param('id.csv') ?? '').replace(/\.csv$/, ''))
    const recon = reconRows().find((r) => Number(r.id) === id)
    if (recon === undefined) throw bad('Сверка не найдена', 404)
    const supplier = one<{ name: string; inn: string | null; contact: string | null; bankDetails: string | null }>(
      `SELECT name, inn, contact, bank_details AS bankDetails FROM suppliers WHERE id=?`, recon.supplierId,
    )
    const iso = (ts: number) => new Date(Number(ts)).toISOString().slice(0, 10)
    const rub = (kop: number) => (Number(kop) / 100).toFixed(2).replace('.', ',')
    const csv = toCsv(
      [{ key: 'field', title: 'Показатель' }, { key: 'value', title: 'Значение' }],
      [
        { field: 'Поставщик', value: supplier?.name ?? `#${recon.supplierId}` },
        { field: 'ИНН', value: supplier?.inn ?? '' },
        { field: 'Контакт', value: supplier?.contact ?? '' },
        { field: 'Реквизиты', value: supplier?.bankDetails ?? '' },
        { field: 'Период с', value: iso(recon.periodFrom) },
        { field: 'Период по', value: iso(recon.periodTo) },
        { field: 'Оборот, ₽', value: rub(recon.turnoverKop) },
        { field: 'Оплаты, ₽', value: rub(recon.paidKop) },
        { field: 'Наш долг, ₽', value: rub(recon.ourBalanceKop) },
        { field: 'По данным поставщика, ₽', value: recon.theirBalanceKop == null ? '' : rub(recon.theirBalanceKop) },
        { field: 'Расхождение, ₽', value: recon.diffKop == null ? '' : rub(recon.diffKop) },
        { field: 'Статус', value: recon.status },
        { field: 'Комментарий', value: recon.notes ?? '' },
      ],
    )
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reconciliation-${id}.csv"`,
      },
    })
  })

  /* ═════════ BANK ROWS (stage 2: manual input, auto-match by supplier name / invoice number) ═════════ */
  .get('/purchases/bank-rows', (c) => c.json({ rows: bankRows() }))

  .post(
    '/purchases/bank-rows',
    zValidator('json', z.object({
      rows: z.array(z.object({
        dateAt: z.number().int(),
        party: z.string().max(300).nullable().optional(),
        purpose: z.string().max(500).nullable().optional(),
        amountKop: z.number().int(),
      })).min(1).max(1000),
    })),
    (c) => {
      const { rows } = c.req.valid('json')
      const sups = all<{ id: number; name: string }>(`SELECT id, name FROM suppliers WHERE active=1`)
      const invs = all<{ id: number; number: string | null; supplier_id: number }>(`SELECT id, number, supplier_id FROM purchase_invoices WHERE status='posted'`)
      const ins = db.prepare(`INSERT INTO bank_rows(date_at, party, purpose, amount_kop, supplier_id, invoice_id, created_at) VALUES(?,?,?,?,?,?,?)`)
      let matched = 0
      db.transaction(() => {
        for (const r of rows) {
          const party = (r.party || '').toLowerCase()
          const sup = sups.find((s) => party && party.includes(s.name.toLowerCase()))
          const purpose = r.purpose || ''
          const inv = invs.find((i) => i.number && purpose.includes(i.number) && (!sup || i.supplier_id === sup.id))
          if (inv) matched++
          ins.run(r.dateAt, r.party ?? null, r.purpose ?? null, r.amountKop, sup?.id ?? inv?.supplier_id ?? null, inv?.id ?? null, now())
        }
      })()
      return c.json({ ok: true, imported: rows.length, matched }, 201)
    },
  )

  .delete('/purchases/bank-rows/:id', (c) => {
    db.prepare(`DELETE FROM bank_rows WHERE id=?`).run(idParam(c.req.param('id')))
    return c.json({ ok: true })
  })

  /**
   * Ручная привязка строки выписки: авто-матч ошибается на нестандартных назначениях,
   * а без этой ручки исправить было нечем. invoiceId=null снимает привязку.
   */
  .patch(
    '/purchases/bank-rows/:id',
    zValidator('json', z.object({
      supplierId: z.number().int().positive().nullable().optional(),
      invoiceId: z.number().int().positive().nullable().optional(),
    })),
    (c) => {
      const id = idParam(c.req.param('id'))
      const row = one<{ supplier_id: number | null; invoice_id: number | null }>(
        `SELECT supplier_id, invoice_id FROM bank_rows WHERE id=?`, id,
      )
      if (!row) throw bad('Строка выписки не найдена', 404)
      const p = c.req.valid('json')

      let supplierId = p.supplierId !== undefined ? p.supplierId : row.supplier_id
      let invoiceId = p.invoiceId !== undefined ? p.invoiceId : row.invoice_id
      if (p.invoiceId !== undefined && p.invoiceId !== null) {
        const inv = one<{ supplier_id: number }>(`SELECT supplier_id FROM purchase_invoices WHERE id=?`, p.invoiceId)
        if (!inv) throw bad('Накладная не найдена', 404)
        if (p.supplierId !== undefined && p.supplierId !== null && p.supplierId !== inv.supplier_id) {
          throw bad('Накладная принадлежит другому поставщику', 400)
        }
        // Накладная всегда тянет за собой своего поставщика.
        supplierId = inv.supplier_id
        invoiceId = p.invoiceId
      }
      if (p.supplierId !== undefined && p.supplierId !== null && !one(`SELECT id FROM suppliers WHERE id=?`, p.supplierId)) {
        throw bad('Поставщик не найден', 404)
      }
      if (p.invoiceId === null) invoiceId = null
      if (p.supplierId === null) supplierId = null

      db.prepare(`UPDATE bank_rows SET supplier_id=?, invoice_id=? WHERE id=?`).run(supplierId ?? null, invoiceId ?? null, id)
      const updated = one(
        `SELECT b.id, b.date_at AS dateAt, b.party, b.purpose, b.amount_kop AS amountKop,
                b.supplier_id AS supplierId, b.invoice_id AS invoiceId,
                i.number AS invoiceNumber
         FROM bank_rows b LEFT JOIN purchase_invoices i ON i.id = b.invoice_id WHERE b.id=?`, id,
      ) as Row
      return c.json({ ok: true, row: { ...updated, matched: updated.invoiceId != null } })
    },
  )

  /**
   * POST /purchases/bank-rows/:id/pay — превращает сопоставленную строку выписки в платёж.
   * До этого шага привязка строки к накладной не влияла на долг: деньги появлялись только
   * через POST /purchases/payments. Здесь платёж создаётся по тем же правилам, что и там
   * (та же валидация статуса/поставщика), а повторный вызов идемпотентен по bank_rows.payment_id.
   */
  .post(
    '/purchases/bank-rows/:id/pay',
    async (c) => {
      const id = idParam(c.req.param('id'))
      const row = one<{
        amountKop: number; supplierId: number | null; invoiceId: number | null; paymentId: number | null
      }>(
        `SELECT amount_kop AS amountKop, supplier_id AS supplierId, invoice_id AS invoiceId, payment_id AS paymentId
         FROM bank_rows WHERE id=?`, id,
      )
      if (!row) throw bad('Строка выписки не найдена', 404)
      if (row.paymentId != null) {
        return c.json({ ok: true, paymentId: row.paymentId, idempotent: true })
      }
      if (row.invoiceId == null) throw bad('Сначала привяжите строку к накладной', 400)

      const linked = one<{ id: number; supplierId: number; status: string; debt: number }>(
        `SELECT id, supplier_id AS supplierId, status, MAX(0, total_kop - paid_kop) AS debt
         FROM purchase_invoices WHERE id=?`, row.invoiceId,
      )
      if (!linked) throw bad('Накладная не найдена', 404)
      if (linked.status !== 'posted') throw bad('Оплата только по проведённым накладным', 400)
      if (row.supplierId != null && row.supplierId !== linked.supplierId) {
        throw bad('Накладная принадлежит другому поставщику', 400)
      }

      // Тело необязательно: пустой запрос — «оплатить по привязке», как удобнее из UI.
      const raw = await c.req.text()
      let body: unknown
      if (raw.trim()) {
        try {
          body = JSON.parse(raw)
        } catch {
          throw bad('Некорректный JSON', 400)
        }
      }
      const parsed = z.object({
        allocations: z.array(z.object({
          invoiceId: z.number().int().positive(),
          amountKop: z.number().int().positive(),
        })).min(1).max(50).optional(),
      }).optional().safeParse(body)
      if (!parsed.success) throw bad('Некорректное распределение оплаты', 400)
      const request = parsed.data ?? {}
      // По умолчанию — вся строка в привязанную накладную, но не больше её долга.
      const allocations = request.allocations ?? [
        { invoiceId: linked.id, amountKop: Math.min(Number(row.amountKop), Number(linked.debt)) },
      ]
      if (allocations.every((a) => a.amountKop <= 0)) throw bad('Накладная уже оплачена', 400)

      const total = allocations.reduce((s, a) => s + a.amountKop, 0)
      if (total > Number(row.amountKop)) throw bad('Сумма распределения больше суммы строки', 400)

      for (const a of allocations) {
        const inv = one<{ supplierId: number; status: string; debt: number }>(
          `SELECT supplier_id AS supplierId, status, MAX(0, total_kop - paid_kop) AS debt
           FROM purchase_invoices WHERE id=?`, a.invoiceId,
        )
        if (!inv) throw bad(`Накладная ${a.invoiceId} не найдена`, 404)
        if (inv.supplierId !== linked.supplierId) throw bad('Накладная другого поставщика', 400)
        if (inv.status !== 'posted') throw bad('Оплата только по проведённым накладным', 400)
        if (a.amountKop > Number(inv.debt)) throw bad(`Сумма больше долга по накладной ${a.invoiceId}`, 400)
      }

      const paymentId = db.transaction(() => {
        const info = db.prepare(
          `INSERT INTO purchase_payments(supplier_id, amount_kop, paid_at, notes, created_at) VALUES(?,?,?,?,?)`,
        ).run(linked.supplierId, total, now(), `Выписка банка №${id}`, now())
        const pid = Number(info.lastInsertRowid)
        const ins = db.prepare(`INSERT INTO purchase_payment_alloc(payment_id, invoice_id, amount_kop) VALUES(?,?,?)`)
        const addPaid = db.prepare(`UPDATE purchase_invoices SET paid_kop = paid_kop + ?, updated_at=? WHERE id=?`)
        for (const a of allocations) {
          ins.run(pid, a.invoiceId, a.amountKop)
          addPaid.run(a.amountKop, now(), a.invoiceId)
        }
        const claimed = db.prepare(
          `UPDATE bank_rows SET payment_id=? WHERE id=? AND payment_id IS NULL`,
        ).run(pid, id)
        // Гонка двух одновременных POST: второй не должен оставить «висящий» платёж.
        if (claimed.changes === 0) throw bad('Строка уже оплачена', 409)
        return pid
      })()

      return c.json({ ok: true, paymentId, allocations })
    },
  )

  /* ═════════ STOCK: recipes + snapshot ═════════ */
  .get('/stock/recipes', (c) => {
    const products = all<{ id: number; name: string; groupName: string | null; price: number }>(
      `SELECT p.id, p.name, p.price, g.name AS groupName FROM products p LEFT JOIN product_groups g ON g.id = p.group_id
       WHERE p.available=1 ORDER BY p.name COLLATE NOCASE`).map((p) => p)
    const norms = all<{ productId: number }>(
      `SELECT n.product_id AS productId, n.stock_item_id AS stockItemId, n.qty, i.name AS itemName, i.unit
       FROM product_stock_norms n JOIN stock_items i ON i.id=n.stock_item_id`)
    const modes = new Map(all<{ product_id: number; mode: string }>(`SELECT product_id, mode FROM product_recipe_modes`).map((m) => [m.product_id, m.mode]))
    const sold = new Map(all<{ product_id: number; q: number }>(
      `SELECT product_id, SUM(qty) q FROM sales_lines WHERE product_id IS NOT NULL AND closed_at >= ? GROUP BY product_id`, now() - 30 * DAY,
    ).map((s) => [s.product_id, Number(s.q)]))
    const by = new Map<number, Row[]>()
    for (const n of norms) (by.get(n.productId) ?? by.set(n.productId, []).get(n.productId)!).push(n as unknown as Row)
    return c.json({
      recipes: products.map((p) => {
        const comps = by.get(p.id) ?? []
        const mode = modes.get(p.id) ?? (comps.length ? 'raw' : 'unset')
        return { productId: p.id, product: p.name, group: p.groupName, mode, sold30d: sold.get(p.id) ?? 0, components: comps }
      }),
    })
  })

  .put(
    '/stock/recipes/:productId',
    zValidator('json', z.object({
      mode: z.enum(['raw', 'piece', 'none']),
      components: z.array(z.object({ stockItemId: z.number().int().positive(), qty: z.number().positive() })).default([]),
    })),
    (c) => {
      const pid = idParam(c.req.param('productId'))
      if (!one(`SELECT id FROM products WHERE id=?`, pid)) throw bad('Товар не найден', 404)
      const p = c.req.valid('json')
      if (p.mode !== 'none' && !p.components.length) throw bad('Добавьте хотя бы один компонент или выберите «Без списания»', 400)
      db.transaction(() => {
        db.prepare(`INSERT INTO product_recipe_modes(product_id, mode, updated_at) VALUES(?,?,?)
                    ON CONFLICT(product_id) DO UPDATE SET mode=excluded.mode, updated_at=excluded.updated_at`).run(pid, p.mode, now())
        db.prepare(`DELETE FROM product_stock_norms WHERE product_id=?`).run(pid)
        const ins = db.prepare(`INSERT INTO product_stock_norms(product_id, stock_item_id, qty) VALUES(?,?,?)`)
        if (p.mode !== 'none') for (const l of p.components) {
          const item = one<{ id: number; unit: string }>(`SELECT id, unit FROM stock_items WHERE id=?`, l.stockItemId)
          if (!item) throw bad(`Позиция ${l.stockItemId} не найдена`, 404)
          assertNormSane(item.unit, l.qty)
          ins.run(pid, l.stockItemId, l.qty)
        }
      })()
      return c.json({ ok: true })
    },
  )

  /** Daily consumption of one item (sale_out + write_off) for the last N days, optionally for one store. */
  .get('/stock/consumption', (c) => {
    const itemId = idParam(c.req.query('itemId') || '')
    const days = Math.min(60, Math.max(1, Number(c.req.query('days') || 7)))
    const store = c.req.query('storeUuid') || null
    const since = new Date(); since.setHours(0, 0, 0, 0)
    const start = since.getTime() - (days - 1) * DAY
    const rows = all<{ at: number; q: number }>(
      `SELECT created_at AS at, -qty AS q FROM stock_movements
       WHERE stock_item_id=? AND qty<0 AND kind IN ('sale_out','write_off') AND created_at>=? ${store ? 'AND store_uuid=?' : ''}`,
      ...([itemId, start] as unknown[]).concat(store ? [store] : []))
    const out = Array.from({ length: days }, (_, i) => ({ day: start + i * DAY, qty: 0 }))
    for (const r of rows) {
      const idx = Math.min(days - 1, Math.max(0, Math.floor((Number(r.at) - start) / DAY)))
      out[idx].qty += Number(r.q)
    }
    return c.json({ days: out })
  })

  /** Stock screen in one call: items + per-store balances + batches. */
  .get('/stock/snapshot', (c) => {
    const stores = all<{ uuid: string; name: string }>(`SELECT store_uuid AS uuid, name FROM evotor_stores ORDER BY name`)
    const items = all<Row>(
      `SELECT id, name, sku, kind, unit, min_qty AS minQty, multiplicity, shelf_life_days AS shelfLifeDays,
              default_supplier_id AS defaultSupplierId, notes, active FROM stock_items WHERE active=1 ORDER BY name COLLATE NOCASE`,
    ).map((it) => {
      const id = Number(it.id)
      const byStore: Record<string, number> = {}
      const consumed24: Record<string, number> = {}
      const lastCount: Record<string, { fact: number; book: number; at: number; status: string; docId: number } | null> = {}
      for (const s of stores) {
        byStore[s.uuid] = stockQty(id, s.uuid)
        consumed24[s.uuid] = Number(one<{ q: number }>(
          `SELECT COALESCE(SUM(-qty),0) q FROM stock_movements WHERE stock_item_id=? AND store_uuid=? AND qty<0 AND kind IN ('sale_out','write_off') AND created_at>=?`,
          id, s.uuid, now() - DAY)?.q) || 0
        // last non-cancelled count (review / counting / posted ≤ 7 days) with a fact for this item+store
        const lc = one<{ fact: number; book: number; at: number; status: string; docId: number }>(
          `SELECT l.fact_qty AS fact, COALESCE(l.book_qty,0) AS book, COALESCE(d.posted_at, d.updated_at) AS at, d.status, d.id AS docId
           FROM inventory_lines l JOIN inventory_docs d ON d.id=l.doc_id
           WHERE l.stock_item_id=? AND d.store_uuid=? AND l.fact_qty IS NOT NULL
             AND (d.status IN ('review','counting') OR (d.status='posted' AND d.posted_at>=?))
           ORDER BY d.id DESC LIMIT 1`, id, s.uuid, now() - 7 * DAY)
        lastCount[s.uuid] = lc ?? null
      }
      const batches = all(
        `SELECT id, lot_code AS lotCode, qty_left AS qtyLeft, unit_cost_kop AS unitCostKop, expires_at AS expiresAt, store_uuid AS storeUuid, supplier_id AS supplierId
         FROM stock_batches WHERE stock_item_id=? AND qty_left>0 ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, id`, id)
      const avgCost = one<{ c: number }>(
        `SELECT CASE WHEN SUM(qty_left)>0 THEN SUM(qty_left*unit_cost_kop)/SUM(qty_left) ELSE 0 END c FROM stock_batches WHERE stock_item_id=? AND qty_left>0`, id)?.c ?? 0
      const lastCost = one<{ c: number }>(`SELECT unit_cost_kop c FROM purchase_invoice_lines WHERE stock_item_id=? ORDER BY id DESC LIMIT 1`, id)?.c ?? 0
      return { ...it, total: stockQty(id), byStore, consumed24, lastCount, batches, avgCostKop: Math.round(Number(avgCost)) || Number(lastCost) }
    })
    return c.json({ stores, items, generatedAt: now() })
  })

  /* ═════════ INVENTORY: extra operations (existing routes untouched) ═════════ */
  /** All inventory docs with progress counters + store names (one call for the list screen). */
  .get('/inventory/overview', (c) => {
    const docs = all(
      `SELECT d.id, d.store_uuid AS storeUuid, st.name AS storeName, d.kind, d.status, d.notes, d.author,
              d.created_at AS createdAt, d.updated_at AS updatedAt, d.posted_at AS postedAt,
              (SELECT COUNT(*) FROM inventory_lines l WHERE l.doc_id=d.id) AS total,
              (SELECT COUNT(*) FROM inventory_lines l WHERE l.doc_id=d.id AND l.fact_qty IS NOT NULL) AS counted
       FROM inventory_docs d LEFT JOIN evotor_stores st ON st.store_uuid=d.store_uuid
       ORDER BY d.id DESC LIMIT 100`)
    return c.json({ docs })
  })

  .get('/inventory/:id/sheet', (c) => {
    const id = idParam(c.req.param('id'))
    const doc = one<Row>(
      `SELECT id, store_uuid AS storeUuid, kind, status, notes, author, created_at AS createdAt, updated_at AS updatedAt, posted_at AS postedAt
       FROM inventory_docs WHERE id=?`, id)
    if (!doc) throw bad('Документ не найден', 404)
    const lines = all(
      `SELECT l.id, l.stock_item_id AS stockItemId, i.name AS itemName, i.unit, l.zone, l.category, l.recount,
              l.book_qty AS bookQty, l.fact_qty AS factQty, i.min_qty AS minQty
       FROM inventory_lines l JOIN stock_items i ON i.id=l.stock_item_id WHERE l.doc_id=? ORDER BY l.zone, i.name COLLATE NOCASE`, id)
    return c.json({ doc, lines })
  })

  .patch(
    '/inventory/:id/meta',
    zValidator('json', z.object({
      author: z.string().max(120).nullable().optional(),
      lines: z.array(z.object({
        stockItemId: z.number().int().positive(),
        zone: z.string().max(60).nullable().optional(),
        category: z.string().max(60).nullable().optional(),
      })).optional(),
    })),
    (c) => {
      const id = idParam(c.req.param('id'))
      if (!one(`SELECT id FROM inventory_docs WHERE id=?`, id)) throw bad('Документ не найден', 404)
      const p = c.req.valid('json')
      db.transaction(() => {
        if (p.author !== undefined) db.prepare(`UPDATE inventory_docs SET author=?, updated_at=? WHERE id=?`).run(p.author, now(), id)
        const upd = db.prepare(`UPDATE inventory_lines SET zone=COALESCE(?,zone), category=COALESCE(?,category) WHERE doc_id=? AND stock_item_id=?`)
        for (const l of p.lines ?? []) upd.run(l.zone ?? null, l.category ?? null, id, l.stockItemId)
      })()
      return c.json({ ok: true })
    },
  )

  /** Send selected lines to recount (clears fact, flags recount) → status counting. */
  .post(
    '/inventory/:id/recount',
    zValidator('json', z.object({ stockItemIds: z.array(z.number().int().positive()).min(1) })),
    (c) => {
      const id = idParam(c.req.param('id'))
      const d = one<{ status: string }>(`SELECT status FROM inventory_docs WHERE id=?`, id)
      if (!d) throw bad('Документ не найден', 404)
      if (d.status === 'posted' || d.status === 'cancelled') throw bad('Документ закрыт', 400)
      const { stockItemIds } = c.req.valid('json')
      db.transaction(() => {
        const upd = db.prepare(`UPDATE inventory_lines SET fact_qty=NULL, recount=1 WHERE doc_id=? AND stock_item_id=?`)
        for (const s of stockItemIds) upd.run(id, s)
        db.prepare(`UPDATE inventory_docs SET status='counting', updated_at=? WHERE id=?`).run(now(), id)
      })()
      return c.json({ ok: true })
    },
  )

  /** Counter finished → review. All lines must have a fact. */
  .post('/inventory/:id/submit', (c) => {
    const id = idParam(c.req.param('id'))
    const d = one<{ status: string }>(`SELECT status FROM inventory_docs WHERE id=?`, id)
    if (!d) throw bad('Документ не найден', 404)
    if (d.status === 'posted' || d.status === 'cancelled') throw bad('Документ закрыт', 400)
    const miss = one<{ n: number }>(`SELECT COUNT(*) n FROM inventory_lines WHERE doc_id=? AND fact_qty IS NULL`, id)?.n ?? 0
    if (miss > 0) throw bad(`Не заполнен факт по ${miss} поз.`, 400)
    db.prepare(`UPDATE inventory_lines SET recount=0 WHERE doc_id=?`).run(id)
    db.prepare(`UPDATE inventory_docs SET status='review', updated_at=? WHERE id=?`).run(now(), id)
    return c.json({ ok: true })
  })

  .post('/inventory/:id/cancel', (c) => {
    const id = idParam(c.req.param('id'))
    const d = one<{ status: string }>(`SELECT status FROM inventory_docs WHERE id=?`, id)
    if (!d) throw bad('Документ не найден', 404)
    if (d.status === 'posted') throw bad('Проведённый документ отменить нельзя', 400)
    db.prepare(`UPDATE inventory_docs SET status='cancelled', updated_at=? WHERE id=?`).run(now(), id)
    return c.json({ ok: true })
  })

  /* ═════════ AI FEED (rule based; real data only) ═════════ */
  .get('/ai/feed', (c) => c.json({ cards: buildAiFeed(), generatedAt: now() }))

  .post('/ai/feed/:key/hide', (c) => {
    const key = c.req.param('key')
    if (!key || key.length > 80) throw bad('Invalid key', 400)
    db.prepare(`INSERT INTO ai_card_hidden(card_key, hidden_until) VALUES(?,?)
                ON CONFLICT(card_key) DO UPDATE SET hidden_until=excluded.hidden_until`).run(key, now() + 7 * DAY)
    return c.json({ ok: true })
  })

  /** Draft of a payment for an invoice: suggested allocation = full remaining debt. Nothing is written. */
  .get('/ai/draft/payment', (c) => {
    const invoiceId = idParam(c.req.query('invoiceId') || '')
    const i = one<{ supplier_id: number; total_kop: number; paid_kop: number; status: string; number: string | null }>(
      `SELECT supplier_id, total_kop, paid_kop, status, number FROM purchase_invoices WHERE id=?`, invoiceId)
    if (!i) throw bad('Накладная не найдена', 404)
    const debt = i.total_kop - i.paid_kop
    if (i.status !== 'posted' || debt <= 0) throw bad('По накладной нет долга', 400)
    return c.json({ draft: { supplierId: i.supplier_id, amountKop: debt, allocations: [{ invoiceId, amountKop: debt }], notes: `Оплата по ${i.number || 'накладной №' + invoiceId}` } })
  })

  /* ═════════ ANALYTICS (computed from loyalty_ops / sales_lines / evotor_docs) ═════════ */
  .get('/analytics/overview', (c) => {
    const { since, until } = periodRange(c.req.query('period'))
    const store = c.req.query('storeUuid') || null
    const channel = c.req.query('channel') // 'card' → only ops with card
    const sf = store ? 'AND doc_store = ?' : ''
    const args: unknown[] = [since, until, ...(store ? [store] : [])]
    const ops = one<{ n: number; rub: number; cups: number; cb: number; free: number }>(
      `SELECT COUNT(*) n, COALESCE(SUM(result_rub),0) rub, COALESCE(SUM(cups_counted),0) cups, COALESCE(SUM(cb),0) cb, COALESCE(SUM(free),0) free
       FROM loyalty_ops WHERE kind='SELL' AND created_at>=? AND created_at<? ${sf}`, ...args)!
    const sells = channel === 'card' ? ops.n : (one<{ n: number }>(
      `SELECT COUNT(*) n FROM evotor_docs WHERE type='SELL' AND received_at>=? AND received_at<? ${store ? 'AND store_uuid = ?' : ''}`, ...args)?.n ?? 0)
    const prev = one<{ rub: number; n: number }>(
      `SELECT COALESCE(SUM(result_rub),0) rub, COUNT(*) n FROM loyalty_ops WHERE kind='SELL' AND created_at>=? AND created_at<? ${sf}`,
      since - (until - since), since, ...(store ? [store] : []))!
    const checks = Math.max(sells, ops.n)
    const sfl = store ? 'AND sl.store_uuid = ?' : ''
    const topProducts = all<{ name: string; category: string; qty: number; revenue: number }>(
      `SELECT COALESCE(sl.name_snapshot,'—') name, COALESCE(c.name,'Без группы') category, SUM(sl.qty) qty, SUM(sl.sum_kopecks)/100.0 revenue
       FROM sales_lines sl LEFT JOIN products p ON p.id=sl.product_id LEFT JOIN categories c ON c.id=p.category_id
       WHERE sl.closed_at>=? AND sl.closed_at<? ${sfl} GROUP BY COALESCE(sl.product_id, sl.name_snapshot) ORDER BY revenue DESC LIMIT 10`, ...args)
    const prevRows = all<{ name: string; revenue: number }>(
      `SELECT COALESCE(sl.name_snapshot,'—') name, SUM(sl.sum_kopecks)/100.0 revenue FROM sales_lines sl
       WHERE sl.closed_at>=? AND sl.closed_at<? ${sfl} GROUP BY COALESCE(sl.product_id, sl.name_snapshot)`, since - (until - since), since, ...(store ? [store] : []))
    const prevBy = new Map(prevRows.map((r) => [r.name, Number(r.revenue)]))
    const topWithTrend = topProducts.map((r) => {
      const pr = prevBy.get(r.name)
      return { ...r, trendPct: pr ? Math.round(((Number(r.revenue) - pr) / pr) * 100) : null }
    })
    const byCategory = all(
      `SELECT COALESCE(c.name,'Без группы') name, SUM(sl.sum_kopecks)/100.0 revenue FROM sales_lines sl
       LEFT JOIN products p ON p.id=sl.product_id LEFT JOIN categories c ON c.id=p.category_id
       WHERE sl.closed_at>=? AND sl.closed_at<? ${sfl} GROUP BY 1 ORDER BY revenue DESC`, ...args)
    const newCustomers = one<{ n: number }>(`SELECT COUNT(*) n FROM users WHERE created_at>=? AND created_at<?`, since, until)?.n ?? 0
    return c.json({
      period: { since, until },
      revenueRub: ops.rub, checks, cups: ops.cups, avgCheckRub: checks ? ops.rub / checks : 0,
      cashbackKop: ops.cb, freeCups: ops.free, cardShare: sells ? ops.n / sells : 0, newCustomers,
      prev: { revenueRub: prev.rub, checks: prev.n },
      topProducts: topWithTrend, byCategory,
      note: 'Выручка — по чекам с картой лояльности (loyalty_ops); чеки без карты считаются только по числу.',
    })
  })

  .get('/analytics/heatmap', (c) => {
    const { since, until } = periodRange(c.req.query('period') || '30d')
    const hs = c.req.query('storeUuid') || null
    const rows = all<{ at: number }>(`SELECT created_at AS at FROM loyalty_ops WHERE kind='SELL' AND created_at>=? AND created_at<? ${hs ? 'AND doc_store = ?' : ''}`, since, until, ...(hs ? [hs] : []))
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
    for (const r of rows) {
      const d = new Date(Number(r.at))
      const dow = (d.getDay() + 6) % 7 // Mon=0
      grid[dow][d.getHours()]++
    }
    return c.json({ grid, days: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'], total: rows.length })
  })

  .get('/analytics/staff', (c) => {
    const { since, until } = periodRange(c.req.query('period'))
    // Attribution: evotor_docs.device_uuid → staff_device_link → staff_members. Only what can be proven.
    const rows = all<{ staffId: number; name: string; role: string; checks: number; withCard: number; rev: number }>(
      `SELECT sm.id AS staffId, sm.name, sm.role, COUNT(d.doc_id) checks,
              SUM(CASE WHEN lo.doc_id IS NOT NULL THEN 1 ELSE 0 END) withCard, COALESCE(SUM(lo.result_rub),0) rev
       FROM evotor_docs d
       JOIN staff_device_link l ON l.device_uuid = d.device_uuid
       JOIN staff_members sm ON sm.id = l.staff_id
       LEFT JOIN loyalty_ops lo ON lo.doc_store=d.store_uuid AND lo.doc_id=d.doc_id AND lo.kind='SELL'
       WHERE d.type='SELL' AND d.received_at>=? AND d.received_at<? GROUP BY sm.id ORDER BY rev DESC`, since, until)
    const sinceDay = new Date(since).toISOString().slice(0, 10), untilDay = new Date(until).toISOString().slice(0, 10)
    const staff = rows.map((r) => ({
      ...r,
      shifts: one<{ n: number }>(`SELECT COUNT(*) n FROM staff_schedule_days WHERE staff_id=? AND status='work' AND day>=? AND day<=?`, r.staffId, sinceDay, untilDay)?.n ?? 0,
    }))
    return c.json({ staff, available: staff.length > 0, note: staff.length ? undefined : 'Нет привязки касс к сотрудникам или нет чеков за период — разбивка недоступна' })
  })

  .get('/analytics/affinity', (c) => {
    const { since, until } = periodRange(c.req.query('period') || '90d')
    const pairs = all(
      `SELECT a.name_snapshot AS a, b.name_snapshot AS b, COUNT(*) n FROM sales_lines a
       JOIN sales_lines b ON a.store_uuid=b.store_uuid AND a.doc_id=b.doc_id AND a.name_snapshot < b.name_snapshot
       WHERE a.closed_at>=? AND a.closed_at<? GROUP BY a.name_snapshot, b.name_snapshot ORDER BY n DESC LIMIT 10`, since, until)
    return c.json({ pairs })
  })

  .get('/analytics/customers', (c) => {
    const t = now()
    const { since, until } = periodRange(c.req.query('period') || '30d')
    const total = one<{ n: number }>(`SELECT COUNT(*) n FROM users`)?.n ?? 0
    const fresh = one<{ n: number }>(`SELECT COUNT(*) n FROM users WHERE created_at>=? AND created_at<?`, since, until)?.n ?? 0
    const rows = all<{ card_id: string; n: number; cups: number; last: number }>(
      `SELECT card_id, COUNT(*) n, COALESCE(SUM(cups_counted),0) cups, MAX(created_at) last FROM loyalty_ops WHERE kind='SELL' AND card_id IS NOT NULL GROUP BY card_id`)
    const seg = { regular: 0, occasional: 0, sleeping: 0, new: fresh }
    let active = 0
    for (const r of rows) {
      const last = Number(r.last)
      if (last >= since && last < until) active++
      if (t - last > 45 * DAY) seg.sleeping++
      else if (r.n >= 8) seg.regular++
      else seg.occasional++
    }
    const repeatShare = rows.length ? rows.filter((r) => r.n >= 2).length / rows.length : 0
    const funnel = [1, 2, 3, 4, 5, 6].map((k) => rows.filter((r) => Number(r.cups) >= k).length)
    const topGuests = all(
      `SELECT u.card_code AS card, SUM(lo.cups_counted) cups, COALESCE(SUM(lo.result_rub),0) rub, MAX(lo.created_at) last, COUNT(*) n
       FROM loyalty_ops lo JOIN users u ON u.card_id = lo.card_id WHERE lo.kind='SELL' GROUP BY lo.card_id ORDER BY cups DESC LIMIT 5`)
    return c.json({ total, active, sleeping: seg.sleeping, segments: seg, repeatShare, funnel, topGuests })
  })

  /** One window of metrics (used by the «Сравнение» screen: any two of 24h / yesterday / 7d / 30d). */
  .get('/analytics/window', (c) => {
    const { since, until } = periodRange(c.req.query('period'))
    const ops = one<{ n: number; rub: number; cups: number; cb: number; free: number }>(
      `SELECT COUNT(*) n, COALESCE(SUM(result_rub),0) rub, COALESCE(SUM(cups_counted),0) cups, COALESCE(SUM(cb),0) cb, COALESCE(SUM(free),0) free
       FROM loyalty_ops WHERE kind='SELL' AND created_at>=? AND created_at<?`, since, until)!
    const docs = one<{ n: number }>(`SELECT COUNT(*) n FROM evotor_docs WHERE type='SELL' AND received_at>=? AND received_at<?`, since, until)?.n ?? 0
    const checks = Math.max(docs, ops.n)
    return c.json({ since, until, checks, card: ops.n, cups: ops.cups, revenue: ops.rub, noCard: Math.max(0, checks - ops.n), cashback: Math.round(ops.cb / 100), gifts: ops.free })
  })

  /** Referral pairs: who invited whom, did the friend buy, bonus paid to the inviter for that friend. */
  .get('/referrals/pairs', (c) => {
    const { since, until } = periodRange(c.req.query('period') || '30d')
    const rows = all<{ fromNick: string | null; fromCard: string | null; toNick: string | null; toCard: string | null; at: number; bought: number; bonusKop: number }>(
      `SELECT u.nickname AS fromNick, u.card_code AS fromCard, f.nickname AS toNick, f.card_code AS toCard, f.created_at AS at,
              EXISTS(SELECT 1 FROM loyalty_ops o WHERE o.card_id=f.card_id AND o.kind='SELL') AS bought,
              COALESCE((SELECT SUM(amount) FROM cashback_ledger WHERE beneficiary_id=u.id AND from_user_id=f.id),0) AS bonusKop
       FROM users f JOIN users u ON u.id=f.invited_by WHERE f.created_at>=? AND f.created_at<? ORDER BY f.created_at DESC LIMIT 200`, since, until)
    const links = one<{ n: number }>(`SELECT COUNT(*) n FROM users WHERE invite_code IS NOT NULL AND invite_code<>''`)?.n ?? 0
    return c.json({
      pairs: rows, invited: rows.length, bought: rows.filter((r) => r.bought).length,
      bonusKop: rows.reduce((s, r) => s + Number(r.bonusKop), 0), links,
    })
  })

  /** Compare two periods (this vs previous of same length). */
  .get('/analytics/compare', (c) => {
    const { since, until } = periodRange(c.req.query('period'))
    const len = until - since
    const f = (a: number, b: number) =>
      one<{ rub: number; n: number; cups: number; cb: number }>(
        `SELECT COALESCE(SUM(result_rub),0) rub, COUNT(*) n, COALESCE(SUM(cups_counted),0) cups, COALESCE(SUM(cb),0) cb
         FROM loyalty_ops WHERE kind='SELL' AND created_at>=? AND created_at<?`, a, b)!
    const cur = f(since, until)
    const prev = f(since - len, since)
    return c.json({ current: cur, previous: prev, period: { since, until, len } })
  })
