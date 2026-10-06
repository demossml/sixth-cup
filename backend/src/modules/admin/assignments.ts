/**
 * Product ↔ Evotor store assignments + overview + sales summary.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { AssignmentSync } from '../../integrations/evotor/sync/AssignmentSync'
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
      lastPollAt = (db.prepare(`SELECT MAX(last_poll_at) AS t FROM evotor_sync_state`).get() as { t: number | null }).t
    } catch {
      /* column may differ */
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
      return c.json(await new AssignmentSync(db).syncProductAssignments(productId))
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
    let lastPollAt: number | null = null
    let sellDocs = 0
    try {
      lastPollAt = (db.prepare(`SELECT MAX(last_poll_at) AS t FROM evotor_sync_state`).get() as { t: number | null }).t
      sellDocs = (db.prepare(`SELECT COUNT(*) AS n FROM evotor_documents WHERE type='SELL'`).get() as { n: number }).n
    } catch {
      /* */
    }
    return c.json({ since: dayStart, lastPollAt, sellDocs, lines })
  })
