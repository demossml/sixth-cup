/**
 * Product ↔ Evotor store assignments + overview + sales summary.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { ProductPushService } from '../../integrations/evotor/sync/ProductPushService'
import { bad } from '../../lib/errors'

function ensureLinkColumns() {
  const cols = db.prepare(`PRAGMA table_info(product_store_links)`).all() as { name: string }[]
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('enabled')) db.exec(`ALTER TABLE product_store_links ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`)
  if (!names.has('allow_to_sell_remote')) {
    db.exec(`ALTER TABLE product_store_links ADD COLUMN allow_to_sell_remote INTEGER NOT NULL DEFAULT 1`)
  }
  if (!names.has('updated_at')) db.exec(`ALTER TABLE product_store_links ADD COLUMN updated_at INTEGER`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_uuid TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      product_id INTEGER,
      evotor_product_uuid TEXT,
      name_snapshot TEXT,
      qty REAL NOT NULL DEFAULT 1,
      sum_kopecks INTEGER NOT NULL DEFAULT 0,
      closed_at INTEGER,
      UNIQUE(store_uuid, doc_id, evotor_product_uuid)
    )
  `)
}

export const adminAssignments = new Hono()
  .get('/overview', (c) => {
    ensureLinkColumns()
    const stores = (db.prepare(`SELECT COUNT(*) AS n FROM evotor_stores`).get() as { n: number }).n
    const products = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM products WHERE available=1 AND COALESCE(catalog_source,'SIXTH_CUP')!='EVOTOR_IMPORT'`,
        )
        .get() as { n: number }
    ).n
    const linked = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM product_store_links WHERE COALESCE(enabled,1)=1 AND evotor_uuid IS NOT NULL`)
        .get() as { n: number }
    ).n
    const pending = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM product_store_links WHERE COALESCE(enabled,1)=1 AND evotor_uuid IS NULL`)
        .get() as { n: number }
    ).n
    const errors = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM product_store_links WHERE last_error IS NOT NULL AND last_error!=''`)
        .get() as { n: number }
    ).n
    let lastPollAt: number | null = null
    try {
      lastPollAt = (db.prepare(`SELECT MAX(COALESCE(last_fast_at, 0), COALESCE(last_hourly_at, 0)) AS t FROM evotor_sync_state ORDER BY t DESC LIMIT 1`).get() as { t: number | null } | undefined)?.t || null
    } catch {
      /* table may be empty */
    }
    return c.json({ stores, products, linked, pending, errors, lastPollAt })
  })

  .put(
    '/products/:id/stores',
    zValidator('json', z.object({ storeUuids: z.array(z.string().min(1)) })),
    (c) => {
      ensureLinkColumns()
      const productId = Number(c.req.param('id'))
      if (!db.prepare(`SELECT id FROM products WHERE id=?`).get(productId)) throw bad('Product not found', 404)
      const unique = [...new Set(c.req.valid('json').storeUuids)]
      const now = Date.now()
      const existing = db
        .prepare(`SELECT store_uuid FROM product_store_links WHERE product_id=?`)
        .all(productId) as { store_uuid: string }[]
      const want = new Set(unique)
      db.transaction(() => {
        for (const row of existing) {
          if (!want.has(row.store_uuid)) {
            db.prepare(
              `UPDATE product_store_links SET enabled=0, updated_at=? WHERE product_id=? AND store_uuid=?`,
            ).run(now, productId, row.store_uuid)
          }
        }
        for (const uuid of unique) {
          db.prepare(`
            INSERT INTO product_store_links(product_id, store_uuid, enabled, updated_at)
            VALUES(?,?,1,?)
            ON CONFLICT(product_id, store_uuid) DO UPDATE SET enabled=1, updated_at=excluded.updated_at, last_error=NULL
          `).run(productId, uuid, now)
        }
      })()
      return c.json({
        productId,
        stores: db
          .prepare(
            `SELECT store_uuid AS storeUuid, evotor_uuid AS evotorUuid, COALESCE(enabled,1) AS enabled,
                    last_error AS lastError, last_pushed_at AS lastPushedAt
             FROM product_store_links WHERE product_id=?`,
          )
          .all(productId),
      })
    },
  )

  .post('/products/:id/sync', async (c) => {
    ensureLinkColumns()
    const productId = Number(c.req.param('id'))
    try {
      const product = db.prepare(`SELECT id FROM products WHERE id=?`).get(productId) as { id: number } | undefined
      if (!product) throw bad('Product not found', 404)
      const stores = db.prepare(`SELECT store_uuid FROM evotor_stores WHERE COALESCE(sync_enabled,0)=1`).all() as { store_uuid: string }[]
      const results = []
      const svc = new ProductPushService(db)
      for (const store of stores) results.push({ storeUuid: store.store_uuid, ...(await svc.pushToStore(store.store_uuid)) })
      const failed = results.reduce((n, r) => n + r.errors.length, 0)
      return c.json({ productId, ok: failed === 0, note: 'Sync uses CatalogSync/ProductPushService; this operation reconciles all pending catalog items at enabled stores.', results })
    } catch (e) {
      throw bad(String(e), 502)
    }
  })

  .get('/sales/summary', (c) => {
    ensureLinkColumns()
    const dayStart = Date.now() - 86_400_000
    let lines: unknown[] = []
    try {
      lines = db
        .prepare(
          `SELECT store_uuid AS storeUuid, COALESCE(product_id, 0) AS productId,
                  COALESCE(name_snapshot, '—') AS name, SUM(qty) AS qty
           FROM sales_lines WHERE closed_at IS NOT NULL AND closed_at >= ?
           GROUP BY store_uuid, product_id, name_snapshot ORDER BY qty DESC`,
        )
        .all(dayStart)
    } catch {
      lines = []
    }
    // Tables are evotor_docs / evotor_sync_state (the old query used non-existent evotor_documents / last_poll_at
    // and silently returned nothing).
    let lastPollAt: number | null = null
    let sellDocs = 0
    let sellFailed = 0
    try {
      lastPollAt = (db.prepare(`SELECT MAX(COALESCE(last_fast_at, 0), COALESCE(last_hourly_at, 0)) AS t FROM evotor_sync_state ORDER BY t DESC LIMIT 1`).get() as { t: number | null } | undefined)?.t || null
      sellDocs = (db.prepare(`SELECT COUNT(*) AS n FROM evotor_docs WHERE type='SELL' AND received_at >= ?`).get(dayStart) as { n: number }).n
      sellFailed = (db.prepare(`SELECT COUNT(*) AS n FROM evotor_docs WHERE type='SELL' AND status='FAILED' AND received_at >= ?`).get(dayStart) as { n: number }).n
    } catch {
      /* */
    }
    let loyalty = { ops: 0, cups: 0, lastOpAt: null as number | null }
    try {
      const r = db.prepare(`SELECT COUNT(*) AS ops, COALESCE(SUM(cups_counted),0) AS cups, MAX(created_at) AS lastOpAt
        FROM loyalty_ops WHERE kind='SELL' AND created_at >= ?`).get(dayStart) as { ops: number; cups: number; lastOpAt: number | null }
      loyalty = r
    } catch {
      /* */
    }
    return c.json({ since: dayStart, lastPollAt, sellDocs, sellFailed, loyalty, lines })
  })

  /** Latest loyalty operations written from Evotor SELL/PAYBACK documents (what the till actually credited). */
  .get('/loyalty/ops', (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50) || 50))
    const rows = db.prepare(`
      SELECT o.doc_store AS storeUuid, o.doc_id AS docId, o.kind, u.card_code AS cardCode,
             o.cups_counted AS cups, o.free, o.cb AS cashbackKopecks, o.result_rub AS resultRub, o.created_at AS createdAt
      FROM loyalty_ops o LEFT JOIN users u ON u.card_id = o.card_id
      ORDER BY o.created_at DESC LIMIT ?
    `).all(limit) as { storeUuid: string; docId: string; [k: string]: unknown }[]
    return c.json({
      ops: rows.map((r) => ({ ...r, storeUuid: r.storeUuid.slice(0, 8), docId: r.docId.slice(0, 8) })),
    })
  })
