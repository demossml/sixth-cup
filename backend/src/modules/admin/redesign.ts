/**
 * Admin redesign read APIs + PATCH product + bulk + optional audit.
 * Additive only — does not change PollService / SellHandler / ProductPush.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { grantVoucher } from '../vouchers/service'

const MS_5M = 5 * 60_000
const MS_30M = 30 * 60_000

function ensureAuditTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      actor TEXT NOT NULL DEFAULT 'admin',
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      before_json TEXT,
      after_json TEXT,
      ip TEXT,
      ok INTEGER NOT NULL DEFAULT 1
    )
  `)
}

function storeLevel(lastAt: number | null, status?: string | null): 'ok' | 'warn' | 'bad' {
  if (status && /error|not_installed/i.test(String(status))) return 'bad'
  if (lastAt == null) return 'bad'
  const age = Date.now() - lastAt
  if (age < MS_5M) return 'ok'
  if (age < MS_30M) return 'warn'
  return 'bad'
}

function enqueueProductSync(productIds: number[]) {
  const ids = [...new Set(productIds.filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) return
  const cols = db.prepare(`PRAGMA table_info(evotor_stores)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'sync_enabled')) {
    db.exec(`ALTER TABLE evotor_stores ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 0`)
  }
  const stores = db.prepare('SELECT store_uuid FROM evotor_stores WHERE COALESCE(sync_enabled,0)=1').all() as {
    store_uuid: string
  }[]
  for (const store of stores) {
    for (const productId of ids) {
      const existing = db
        .prepare(
          `SELECT id FROM evotor_outbox WHERE store_uuid=? AND entity='PRODUCT' AND entity_key=? AND status='PENDING' LIMIT 1`,
        )
        .get(store.store_uuid, String(productId)) as { id: number } | undefined
      if (existing) db.prepare(`UPDATE evotor_outbox SET next_at=?,last_error=NULL WHERE id=?`).run(Date.now(), existing.id)
      else
        db.prepare(
          `INSERT INTO evotor_outbox(store_uuid,entity,entity_key,op,priority,status,attempts,next_at) VALUES(?,?,?,?,5,'PENDING',0,?)`,
        ).run(store.store_uuid, 'PRODUCT', String(productId), 'UPSERT', Date.now())
    }
  }
}

function audit(opts: {
  method: string
  path: string
  entity?: string
  entityId?: string
  before?: unknown
  after?: unknown
  ok?: boolean
  ip?: string
}) {
  try {
    ensureAuditTable()
    db.prepare(
      `INSERT INTO admin_audit(at,actor,method,path,entity,entity_id,before_json,after_json,ip,ok) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      Date.now(),
      'admin',
      opts.method,
      opts.path,
      opts.entity ?? null,
      opts.entityId ?? null,
      opts.before != null ? JSON.stringify(opts.before).slice(0, 4000) : null,
      opts.after != null ? JSON.stringify(opts.after).slice(0, 4000) : null,
      opts.ip ?? null,
      opts.ok === false ? 0 : 1,
    )
  } catch {
    /* non-fatal */
  }
}

export const adminRedesign = new Hono()
  .get('/dashboard', (c) => {
    const from = Number(c.req.query('from') ?? Date.now() - 24 * 3600_000)
    const to = Number(c.req.query('to') ?? Date.now())
    const store = c.req.query('store') ?? ''

    const storeFilter = store ? 'AND store_uuid = ?' : ''
    const storeParams = store ? [store] : []

    const sellCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM evotor_docs WHERE type='SELL' AND close_date_ms>=? AND close_date_ms<=? ${storeFilter}`,
        )
        .get(from, to, ...storeParams) as { n: number }
    ).n

    const sellFailed = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM evotor_docs WHERE type='SELL' AND status='FAILED' AND close_date_ms>=? AND close_date_ms<=? ${storeFilter}`,
        )
        .get(from, to, ...storeParams) as { n: number }
    ).n

    const ops = db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(cups_counted),0) AS cups FROM loyalty_ops WHERE created_at>=? AND created_at<=? ${
          store ? 'AND doc_store=?' : ''
        }`,
      )
      .get(from, to, ...(store ? [store] : [])) as { n: number; cups: number }

    const outboxPending = (
      db.prepare(`SELECT COUNT(*) AS n FROM evotor_outbox WHERE status='PENDING'`).get() as { n: number }
    ).n

    let lastPollAt: number | null = null
    try {
      const row = db
        .prepare(`SELECT MAX(COALESCE(last_fast_at, last_hourly_at, 0)) AS t FROM evotor_sync_state`)
        .get() as { t: number | null }
      lastPollAt = row.t && row.t > 0 ? row.t : null
    } catch {
      lastPollAt = null
    }

    const stores = db
      .prepare(
        `SELECT s.store_uuid AS storeUuid, s.name, COALESCE(s.sync_enabled,0) AS syncEnabled,
                st.status AS status,
                st.last_fast_at AS lastFastAt, st.last_hourly_at AS lastHourlyAt
         FROM evotor_stores s
         LEFT JOIN evotor_sync_state st ON st.store_uuid = s.store_uuid
         ORDER BY s.name`,
      )
      .all() as {
      storeUuid: string
      name: string
      syncEnabled: number
      status: string | null
      lastFastAt: number | null
      lastHourlyAt: number | null
    }[]

    const storesHealth = stores.map((s) => {
      const last = Math.max(s.lastFastAt ?? 0, s.lastHourlyAt ?? 0) || null
      return {
        storeUuid: s.storeUuid,
        name: s.name,
        syncEnabled: !!s.syncEnabled,
        status: s.status,
        lastPollAt: last,
        level: storeLevel(last, s.status),
      }
    })

    const recentOps = db
      .prepare(
        `SELECT doc_store AS storeUuid, doc_id AS docId, kind, card_id AS cardId,
                cups_counted AS cups, result_rub AS resultRub, free, cb, created_at AS createdAt
         FROM loyalty_ops ORDER BY created_at DESC LIMIT 20`,
      )
      .all()

    const problemDocs = db
      .prepare(
        `SELECT store_uuid AS storeUuid, doc_id AS docId, status, last_error AS lastError, close_date_ms AS closeDateMs
         FROM evotor_docs WHERE type='SELL' AND (status='FAILED' OR (status='PROCESSED' AND last_error IS NOT NULL AND last_error!=''))
         ORDER BY close_date_ms DESC LIMIT 15`,
      )
      .all()

    return c.json({
      from,
      to,
      sellCount,
      sellFailed,
      opsCount: ops.n,
      cupsSum: ops.cups,
      outboxPending,
      lastPollAt,
      storesHealth,
      recentOps,
      problemDocs,
    })
  })

  .get('/evotor/health', (c) => {
    const stores = db
      .prepare(
        `SELECT s.store_uuid AS storeUuid, s.name, COALESCE(s.sync_enabled,0) AS syncEnabled, st.status AS status,
                st.last_fast_at AS lastFastAt, st.last_hourly_at AS lastHourlyAt
         FROM evotor_stores s
         LEFT JOIN evotor_sync_state st ON st.store_uuid = s.store_uuid`,
      )
      .all() as {
      storeUuid: string
      name: string
      syncEnabled: number
      status: string | null
      lastFastAt: number | null
      lastHourlyAt: number | null
    }[]

    const outboxByStore = new Map<string, number>()
    for (const row of db
      .prepare(`SELECT store_uuid AS s, COUNT(*) AS n FROM evotor_outbox WHERE status='PENDING' GROUP BY store_uuid`)
      .all() as { s: string; n: number }[]) {
      outboxByStore.set(row.s, row.n)
    }

    return c.json({
      stores: stores.map((s) => {
        const last = Math.max(s.lastFastAt ?? 0, s.lastHourlyAt ?? 0) || null
        return {
          storeUuid: s.storeUuid,
          name: s.name,
          syncEnabled: !!s.syncEnabled,
          status: s.status,
          lastPollAt: last,
          outboxPending: outboxByStore.get(s.storeUuid) ?? 0,
          level: storeLevel(last, s.status),
        }
      }),
      generatedAt: Date.now(),
    })
  })

  .get('/operations', (c) => {
    const store = c.req.query('store') ?? ''
    const kind = c.req.query('kind') ?? ''
    const status = c.req.query('status') ?? ''
    const q = (c.req.query('q') ?? '').trim()
    const from = Number(c.req.query('from') ?? 0)
    const to = Number(c.req.query('to') ?? Date.now())
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50)))

    const where: string[] = ['d.close_date_ms >= ?', 'd.close_date_ms <= ?']
    const params: unknown[] = [from || 0, to]

    if (store) {
      where.push('d.store_uuid = ?')
      params.push(store)
    }
    if (status) {
      where.push('d.status = ?')
      params.push(status)
    }
    if (kind === 'SELL' || kind === 'PAYBACK') {
      where.push('d.type = ?')
      params.push(kind)
    } else if (kind === 'ops') {
      where.push('o.doc_id IS NOT NULL')
    }
    if (q) {
      where.push(`(d.doc_id LIKE ? OR o.card_id LIKE ? OR EXISTS (
        SELECT 1 FROM users u
        WHERE u.card_id = o.card_id AND (u.card_code LIKE ? OR CAST(u.id AS TEXT) = ?)
      ))`)
      const like = `%${q}%`
      params.push(like, like, like, q)
    }

    params.push(limit)
    const rows = db
      .prepare(
        `SELECT d.store_uuid AS storeUuid, d.doc_id AS docId, d.type AS kind, d.status,
                d.close_date_ms AS closeDateMs, d.last_error AS lastError,
                o.cups_counted AS cups, o.result_rub AS resultRub, o.card_id AS cardId,
                o.free, o.cb, o.created_at AS opAt
         FROM evotor_docs d
         LEFT JOIN loyalty_ops o ON o.doc_store = d.store_uuid AND o.doc_id = d.doc_id
         WHERE ${where.join(' AND ')}
         ORDER BY d.close_date_ms DESC
         LIMIT ?`,
      )
      .all(...params)

    // enrich card_code
    const enriched = rows.map((r: any) => {
      let cardCode: string | null = null
      if (r.cardId) {
        const u = db
          .prepare(
            `SELECT u.card_code FROM users u WHERE u.card_id=? LIMIT 1`,
          )
          .get(r.cardId) as { card_code: string } | undefined
        cardCode = u?.card_code ?? null
      }
      return { ...r, cardCode }
    })

    return c.json({ items: enriched, limit })
  })

  .get('/operations.csv', (c) => {
    const from = Number(c.req.query('from') ?? 0)
    const to = Number(c.req.query('to') ?? Date.now())
    const rows = db
      .prepare(
        `SELECT d.close_date_ms, d.store_uuid, d.doc_id, d.type, d.status, d.last_error,
                o.cups_counted, o.result_rub, o.card_id
         FROM evotor_docs d
         LEFT JOIN loyalty_ops o ON o.doc_store=d.store_uuid AND o.doc_id=d.doc_id
         WHERE d.close_date_ms>=? AND d.close_date_ms<=?
         ORDER BY d.close_date_ms DESC LIMIT 5000`,
      )
      .all(from || 0, to) as any[]

    const header = 'close_date_ms,store_uuid,doc_id,type,status,last_error,cups,result_rub,card_id\n'
    const body = rows
      .map((r) =>
        [r.close_date_ms, r.store_uuid, r.doc_id, r.type, r.status, JSON.stringify(r.last_error ?? ''), r.cups_counted ?? '', r.result_rub ?? '', r.card_id ?? ''].join(
          ',',
        ),
      )
      .join('\n')
    return new Response(header + body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="operations.csv"',
      },
    })
  })

  .get('/operations/:store/:doc', (c) => {
    const store = c.req.param('store')
    const doc = c.req.param('doc')
    const d = db
      .prepare(
        `SELECT store_uuid AS storeUuid, doc_id AS docId, type, status, device_uuid AS deviceUuid,
                close_date_ms AS closeDateMs, last_error AS lastError, received_at AS receivedAt,
                processed_at AS processedAt, wl_json AS wlJson
         FROM evotor_docs WHERE store_uuid=? AND doc_id=?`,
      )
      .get(store, doc) as any
    if (!d) throw bad('Document not found', 404)

    const op = db
      .prepare(
        `SELECT kind, card_id AS cardId, cups_counted AS cups, result_rub AS resultRub, free, cb, created_at AS createdAt
         FROM loyalty_ops WHERE doc_store=? AND doc_id=?`,
      )
      .get(store, doc)

    // mask long tokens in wl_json
    let wl: unknown = null
    if (d.wlJson) {
      try {
        const parsed = JSON.parse(d.wlJson)
        const s = JSON.stringify(parsed)
        wl = s.length > 8000 ? { _truncated: true, preview: s.slice(0, 4000) } : parsed
      } catch {
        wl = { _raw: String(d.wlJson).slice(0, 2000) }
      }
    }
    delete d.wlJson

    return c.json({ doc: d, op, wl })
  })

  .get('/customers', (c) => {
    const q = (c.req.query('q') ?? '').trim()
    const sort = c.req.query('sort') ?? 'created_at'
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50)))
    const cursor = Number(c.req.query('cursor') ?? 0)

    const order =
      sort === 'paid_total'
        ? 'COALESCE(c.paid_total,0) DESC, u.id DESC'
        : 'u.created_at DESC, u.id DESC'

    const where: string[] = ['1=1']
    const params: unknown[] = []
    if (q) {
      where.push(`(u.card_code LIKE ? OR u.nickname LIKE ? OR CAST(u.id AS TEXT)=? OR u.card_id LIKE ?)`)
      const like = `%${q}%`
      params.push(like, like, q, like)
    }
    if (cursor > 0) {
      where.push('u.id < ?')
      params.push(cursor)
    }
    params.push(limit)

    const items = db
      .prepare(
        `SELECT u.id, u.card_code AS cardCode, u.card_id AS cardId, u.nickname,
                u.cashback_balance AS cashbackBalance, u.invite_code AS inviteCode,
                u.invited_by AS invitedBy, u.created_at AS createdAt,
                COALESCE(c.paid_total,0) AS paidTotal, COALESCE(c.free_used,0) AS freeUsed
         FROM users u
         LEFT JOIN cards c ON c.user_id = u.id
         WHERE ${where.join(' AND ')}
         ORDER BY ${order}
         LIMIT ?`,
      )
      .all(...params)

    return c.json({ items, limit })
  })

  .get('/customers/:id', (c) => {
    const id = Number(c.req.param('id'))
    const includePhone = c.req.query('includePhone') === '1'
    const u = db
      .prepare(
        `SELECT u.id, u.card_code AS cardCode, u.card_id AS cardId, u.nickname, u.phone,
                u.cashback_balance AS cashbackBalance, u.invite_code AS inviteCode,
                u.invited_by AS invitedBy, u.created_at AS createdAt,
                COALESCE(c.paid_total,0) AS paidTotal, COALESCE(c.free_used,0) AS freeUsed, c.seq
         FROM users u LEFT JOIN cards c ON c.user_id=u.id WHERE u.id=?`,
      )
      .get(id) as any
    if (!u) throw bad('Customer not found', 404)

    let phone: string | null = null
    if (includePhone && u.phone && !String(u.phone).startsWith('guest:')) {
      phone = u.phone
    }
    delete u.phone

    let inviter: { id: number; cardCode: string | null } | null = null
    if (u.invitedBy) {
      const inv = db
        .prepare(`SELECT id, card_code AS cardCode FROM users WHERE id=?`)
        .get(u.invitedBy) as { id: number; cardCode: string | null } | undefined
      inviter = inv ?? null
    }

    const ops = db
      .prepare(
        `SELECT doc_store AS storeUuid, doc_id AS docId, kind, cups_counted AS cups, result_rub AS resultRub,
                free, cb, created_at AS createdAt
         FROM loyalty_ops WHERE card_id=? OR card_id=? ORDER BY created_at DESC LIMIT 30`,
      )
      .all(u.cardId, u.cardId)

    const cashback = db
      .prepare(
        `SELECT beneficiary_id AS beneficiaryId, from_user_id AS fromUserId, receipt_id AS receiptId,
                amount, created_at AS createdAt
         FROM cashback_ledger WHERE beneficiary_id=? OR from_user_id=? ORDER BY created_at DESC LIMIT 30`,
      )
      .all(id, id)

    let vouchers: unknown[] = []
    try {
      vouchers = db
        .prepare(
          `SELECT id, title, kind, value, expires_day AS expiresDay
           FROM vouchers WHERE user_id=? ORDER BY created_at DESC LIMIT 20`,
        )
        .all(id)
    } catch {
      vouchers = []
    }

    const explain: string[] = []
    if (!ops.length) explain.push('Нет операций лояльности по этой карте')
    if (inviter) explain.push(`Приглашён пользователем id=${inviter.id} (карта ${inviter.cardCode ?? '—'})`)
    else explain.push('Пришёл без приглашения (invited_by пуст)')
    if (u.cashbackBalance > 0) explain.push(`Кэшбэк на балансе: ${(u.cashbackBalance / 100).toFixed(2)} ₽`)

    return c.json({
      customer: { ...u, phone },
      inviter,
      ops,
      cashback,
      vouchers,
      explain,
    })
  })

  .patch(
    '/products/:id',
    zValidator(
      'json',
      z.object({
        name: z.string().min(1).max(200).optional(),
        price: z.number().nonnegative().optional(),
        available: z.boolean().optional(),
        countsAsCup: z.boolean().optional(),
        categoryId: z.number().int().nullable().optional(),
        description: z.string().max(2000).optional().nullable(),
        expectedUpdatedAt: z.number().optional(),
      }),
    ),
    (c) => {
      const id = Number(c.req.param('id'))
      const body = c.req.valid('json')
      const row = db.prepare(`SELECT * FROM products WHERE id=?`).get(id) as Record<string, unknown> | undefined
      if (!row) throw bad('Product not found', 404)
      if (body.expectedUpdatedAt != null && Number(row.updated_at) !== body.expectedUpdatedAt) {
        throw bad('Conflict: product was modified', 409)
      }
      const now = Date.now()
      const name = body.name ?? row.name
      const price = body.price ?? row.price
      const available = body.available !== undefined ? (body.available ? 1 : 0) : row.available
      const counts = body.countsAsCup !== undefined ? (body.countsAsCup ? 1 : 0) : row.counts_as_cup
      const categoryId = body.categoryId !== undefined ? body.categoryId : row.category_id
      const description = body.description !== undefined ? body.description : row.description
      db.prepare(
        `UPDATE products SET name=?, price=?, available=?, counts_as_cup=?, category_id=?, description=?, updated_at=? WHERE id=?`,
      ).run(name, price, available, counts, categoryId, description, now, id)
      enqueueProductSync([id])
      audit({
        method: 'PATCH',
        path: `/products/${id}`,
        entity: 'product',
        entityId: String(id),
        before: { name: row.name, price: row.price, available: row.available, counts_as_cup: row.counts_as_cup },
        after: { name, price, available, counts, categoryId },
      })
      return c.json({ ok: true, id, updatedAt: now })
    },
  )

  .post(
    '/products/bulk',
    zValidator(
      'json',
      z.object({
        ids: z.array(z.number().int().positive()).min(1).max(200),
        dryRun: z.boolean().optional(),
        patch: z
          .object({
            price: z.number().nonnegative().optional(),
            available: z.boolean().optional(),
            countsAsCup: z.boolean().optional(),
          })
          .optional(),
        action: z.enum(['archive', 'unarchive']).optional(),
      }),
    ),
    (c) => {
      const body = c.req.valid('json')
      const changes: { id: number; before: unknown; after: unknown }[] = []
      for (const id of body.ids) {
        const row = db.prepare(`SELECT id, name, price, available, counts_as_cup FROM products WHERE id=?`).get(id) as
          | any
          | undefined
        if (!row) continue
        const after: any = { ...row }
        if (body.action === 'archive') after.available = 0
        if (body.action === 'unarchive') after.available = 1
        if (body.patch?.price !== undefined) after.price = body.patch.price
        if (body.patch?.available !== undefined) after.available = body.patch.available ? 1 : 0
        if (body.patch?.countsAsCup !== undefined) after.counts_as_cup = body.patch.countsAsCup ? 1 : 0
        changes.push({ id, before: row, after })
      }
      if (body.dryRun) return c.json({ dryRun: true, changes })

      const now = Date.now()
      const tx = db.transaction(() => {
        for (const ch of changes) {
          const a = ch.after as any
          db.prepare(`UPDATE products SET price=?, available=?, counts_as_cup=?, updated_at=? WHERE id=?`).run(
            a.price,
            a.available,
            a.counts_as_cup,
            now,
            ch.id,
          )
        }
      })
      tx()
      enqueueProductSync(changes.map((c) => c.id))
      audit({
        method: 'POST',
        path: '/products/bulk',
        entity: 'product',
        after: { count: changes.length, ids: changes.map((c) => c.id) },
      })
      return c.json({ ok: true, updated: changes.length })
    },
  )

  .get('/audit', (c) => {
    ensureAuditTable()
    const limit = Math.min(100, Number(c.req.query('limit') ?? 50))
    const items = db
      .prepare(
        `SELECT id, at, actor, method, path, entity, entity_id AS entityId, before_json AS beforeJson,
                after_json AS afterJson, ok FROM admin_audit ORDER BY id DESC LIMIT ?`,
      )
      .all(limit)
    return c.json({ items })
  })

  .get('/voucher-templates', (c) => {
    try {
      const items = db.prepare(`SELECT * FROM voucher_templates ORDER BY id`).all()
      return c.json({ items })
    } catch {
      return c.json({ items: [] })
    }
  })

  .post(
    '/customers/:id/vouchers',
    zValidator('json', z.object({ code: z.string().min(1) })),
    (c) => {
      const id = Number(c.req.param('id'))
      const { code } = c.req.valid('json')
      const u = db.prepare(`SELECT id FROM users WHERE id=?`).get(id)
      if (!u) throw bad('Customer not found', 404)
      try {
        grantVoucher(id, code)
      } catch (e: any) {
        throw bad(e?.message ?? 'Grant failed', 400)
      }
      audit({ method: 'POST', path: `/customers/${id}/vouchers`, entity: 'voucher', entityId: code, after: { userId: id } })
      return c.json({ ok: true })
    },
  )
