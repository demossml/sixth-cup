/**
 * Admin console endpoints (redesign): dashboard, operations journal, customers, till health,
 * product partial/bulk edits, vouchers, audit journal, CSV exports.
 * Everything here is additive: existing admin endpoints keep their behaviour.
 * Reads are plain SELECTs. Writes: PATCH /products/:id, POST /products/bulk, POST /customers/:id/vouchers.
 */
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { config } from '../../config'
import { log } from '../../lib/logBuffer'
import { grantVoucher } from '../vouchers/service'
import { enqueueProductSync } from './enqueue'
import { writeAudit } from './audit'
import type { AuditInput } from './audit'
import {
  HEALTH_DEFAULTS, decodeCursor, diffProduct, encodeCursor, likeEscape, periodSince,
  storeHealth, toCsv, worstLevel, nextPrice,
  type FieldChange, type ProductPatch,
} from './consoleLib'

type Env = { Variables: { audit?: Partial<AuditInput> } }

function thresholds() {
  const warn = Number(process.env.EVOTOR_HEALTH_WARN_MIN)
  const crit = Number(process.env.EVOTOR_HEALTH_CRIT_MIN)
  return {
    warnMin: Number.isFinite(warn) && warn > 0 ? warn : HEALTH_DEFAULTS.warnMin,
    critMin: Number.isFinite(crit) && crit > 0 ? crit : HEALTH_DEFAULTS.critMin,
  }
}

function ensureSyncEnabledColumn() {
  const cols = db.prepare(`PRAGMA table_info(evotor_stores)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'sync_enabled')) {
    db.exec(`ALTER TABLE evotor_stores ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 0`)
  }
}

export function queryStoreHealth(now = Date.now()) {
  ensureSyncEnabledColumn()
  const th = thresholds()
  const rows = db.prepare(`
    SELECT s.store_uuid AS uuid, s.name, COALESCE(s.sync_enabled,0) AS enabled,
           st.status, st.last_error AS lastError, st.last_fast_at AS lastFastAt,
           st.last_hourly_at AS lastHourlyAt, st.last_daily_at AS lastDailyAt,
           (SELECT COUNT(*) FROM evotor_outbox o WHERE o.store_uuid=s.store_uuid AND o.status='PENDING') AS outboxPending,
           (SELECT COUNT(*) FROM evotor_outbox o WHERE o.store_uuid=s.store_uuid AND o.status='PENDING' AND o.last_error IS NOT NULL) AS outboxWithError,
           (SELECT COUNT(*) FROM evotor_docs d WHERE d.store_uuid=s.store_uuid AND d.status='FAILED') AS failedDocs
    FROM evotor_stores s LEFT JOIN evotor_sync_state st ON st.store_uuid=s.store_uuid
    ORDER BY s.name, s.store_uuid
  `).all() as {
    uuid: string; name: string | null; enabled: number; status: string | null; lastError: string | null
    lastFastAt: number | null; lastHourlyAt: number | null; lastDailyAt: number | null
    outboxPending: number; outboxWithError: number; failedDocs: number
  }[]
  const stores = rows.map((r) => {
    const h = storeHealth({ enabled: r.enabled === 1, status: r.status, lastOkAt: r.lastFastAt }, now, th)
    return { ...r, enabled: r.enabled === 1, level: h.level, ageMin: h.ageMin, reason: h.reason }
  })
  return { thresholds: th, level: worstLevel(stores.map((s) => s.level)), stores }
}

// ---------- operations ----------

type OpsQuery = { store?: string; view?: string; type?: string; q?: string; from?: number; to?: number; cursor?: string; limit: number; includeIgnored?: boolean }

const OPS_SELECT = `
  SELECT d.store_uuid AS storeUuid, s.name AS storeName, d.doc_id AS docId, d.type, d.status, d.attempts,
         d.last_error AS lastError, d.close_date_ms AS closedAt, d.received_at AS receivedAt, d.processed_at AS processedAt,
         d.source, d.number,
         o.kind AS opKind, o.cups_counted AS cups, o.free, o.cb AS cashbackKopecks, o.result_rub AS resultRub,
         o.op_claimed AS opClaimed, o.q_claimed AS qClaimed, o.card_id AS cardId,
         u.id AS userId, u.card_code AS cardCode, u.nickname
  FROM evotor_docs d
  LEFT JOIN evotor_stores s ON s.store_uuid = d.store_uuid
  LEFT JOIN loyalty_ops o ON o.doc_store = d.store_uuid AND o.doc_id = d.doc_id
  LEFT JOIN users u ON u.card_id = o.card_id
`

function opsWhere(q: OpsQuery): { where: string; args: unknown[] } {
  const w: string[] = []
  const a: unknown[] = []
  if (q.store) { w.push('d.store_uuid = ?'); a.push(q.store) }
  if (q.type) { w.push('d.type = ?'); a.push(q.type) }
  if (!q.includeIgnored && q.view !== 'errors') w.push(`d.status != 'IGNORED'`)
  if (q.view === 'credited') w.push('o.doc_id IS NOT NULL AND o.card_id IS NOT NULL')
  else if (q.view === 'nocard') w.push(`d.type IN ('SELL','PAYBACK') AND d.status = 'PROCESSED' AND (o.doc_id IS NULL OR o.card_id IS NULL)`)
  else if (q.view === 'errors') w.push(`d.status = 'FAILED'`)
  if (typeof q.from === 'number') { w.push('d.close_date_ms >= ?'); a.push(q.from) }
  if (typeof q.to === 'number') { w.push('d.close_date_ms <= ?'); a.push(q.to) }
  const text = q.q?.trim()
  if (text) {
    if (/^\d+$/.test(text)) { w.push('(u.card_code = ? OR d.number = ?)'); a.push(text, Number(text)) }
    else { w.push(`d.doc_id LIKE ? ESCAPE '\\'`); a.push(likeEscape(text) + '%') }
  }
  const cur = decodeCursor(q.cursor)
  if (cur) { w.push('(d.close_date_ms < ? OR (d.close_date_ms = ? AND d.doc_id < ?))'); a.push(cur.t, cur.t, cur.id) }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', args: a }
}

export function queryOperations(q: OpsQuery) {
  const { where, args } = opsWhere(q)
  const rows = db.prepare(`${OPS_SELECT} ${where} ORDER BY d.close_date_ms DESC, d.doc_id DESC LIMIT ?`)
    .all(...args, q.limit + 1) as (Record<string, unknown> & { closedAt: number; docId: string })[]
  const more = rows.length > q.limit
  const page = more ? rows.slice(0, q.limit) : rows
  const last = page[page.length - 1]
  return { ops: page, next: more && last ? encodeCursor(last.closedAt, last.docId) : null }
}

const num = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
function opsQueryFrom(c: { req: { query: (k: string) => string | undefined } }, limit: number, cursor = true): OpsQuery {
  return {
    store: c.req.query('store') || undefined,
    view: c.req.query('view') || undefined,
    type: c.req.query('type') || undefined,
    q: c.req.query('q') || undefined,
    from: num(c.req.query('from')),
    to: num(c.req.query('to')),
    includeIgnored: c.req.query('includeIgnored') === '1',
    cursor: cursor ? c.req.query('cursor') || undefined : undefined,
    limit,
  }
}

// ---------- products ----------

const patchFields = z.object({
  available: z.boolean().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  countsAsCup: z.boolean().optional(),
  freeEligible: z.boolean().optional(),
  price: z.number().int().min(0).optional(),
  priceDelta: z.number().int().optional(),
  pricePercent: z.number().min(-90).max(500).optional(),
})
const priceModes = (p: z.infer<typeof patchFields>) => [p.price, p.priceDelta, p.pricePercent].filter((x) => x !== undefined).length

type ProductRow = { id: number; name: string; price: number; available: number; category_id: number | null; counts_as_cup: number; free_eligible: number; updated_at: number | null }
const PRODUCT_COLS = `id, name, price, available, category_id, counts_as_cup, free_eligible, updated_at`

function setProductFields(id: number, changes: FieldChange[], now: number) {
  const col: Record<string, string> = { price: 'price', available: 'available', categoryId: 'category_id', countsAsCup: 'counts_as_cup', freeEligible: 'free_eligible' }
  const sets: string[] = []
  const vals: unknown[] = []
  for (const ch of changes) {
    sets.push(`${col[ch.field]} = ?`)
    vals.push(typeof ch.to === 'boolean' ? (ch.to ? 1 : 0) : ch.to)
  }
  // Same as POST /products: an admin edit makes the product ours (catalog_source='SIXTH_CUP').
  db.prepare(`UPDATE products SET ${sets.join(', ')}, updated_at = ?, catalog_source = 'SIXTH_CUP' WHERE id = ?`).run(...vals, now, id)
}

export const adminConsole = new Hono<Env>()
  // ---------- what the UI may offer on this server ----------
  .get('/meta', (c) => c.json({ production: !config.isDev, resetAllowed: config.adminAllowReset }))

  // ---------- till health ----------
  .get('/evotor/health', (c) => c.json({ now: Date.now(), ...queryStoreHealth() }))

  // ---------- dashboard ----------
  .get('/dashboard', (c) => {
    const now = Date.now()
    const { period, since } = periodSince(c.req.query('period'), now)
    const store = c.req.query('store') || undefined
    const sArg = store ? [store] : []
    const docRows = db.prepare(`
      SELECT type, status, COUNT(*) AS n FROM evotor_docs
      WHERE received_at >= ? AND type IN ('SELL','PAYBACK') ${store ? 'AND store_uuid = ?' : ''}
      GROUP BY type, status`).all(since, ...sArg) as { type: string; status: string; n: number }[]
    const docs = { sell: 0, sellFailed: 0, payback: 0, paybackFailed: 0 }
    for (const r of docRows) {
      if (r.type === 'SELL') { docs.sell += r.n; if (r.status === 'FAILED') docs.sellFailed += r.n }
      else { docs.payback += r.n; if (r.status === 'FAILED') docs.paybackFailed += r.n }
    }
    const ops = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN kind='SELL' THEN 1 ELSE 0 END),0) AS sells,
             COALESCE(SUM(CASE WHEN kind='PAYBACK' THEN 1 ELSE 0 END),0) AS paybacks,
             COALESCE(SUM(CASE WHEN kind='SELL' THEN cups_counted ELSE 0 END),0) AS cups,
             COALESCE(SUM(CASE WHEN kind='PAYBACK' THEN cups_counted ELSE 0 END),0) AS cupsReturned,
             COALESCE(SUM(CASE WHEN kind='SELL' THEN free ELSE 0 END),0) AS free,
             COALESCE(SUM(CASE WHEN kind='SELL' THEN cb ELSE 0 END),0) AS cashbackKopecks,
             COALESCE(SUM(CASE WHEN kind='SELL' THEN result_rub ELSE 0 END),0) AS resultRub,
             MAX(created_at) AS lastOpAt
      FROM loyalty_ops WHERE created_at >= ? ${store ? 'AND doc_store = ?' : ''}`).get(since, ...sArg) as Record<string, number | null>
    const noCard = (db.prepare(`
      SELECT COUNT(*) AS n FROM evotor_docs d LEFT JOIN loyalty_ops o ON o.doc_store=d.store_uuid AND o.doc_id=d.doc_id
      WHERE d.received_at >= ? AND d.type='SELL' AND d.status='PROCESSED' AND (o.doc_id IS NULL OR o.card_id IS NULL) ${store ? 'AND d.store_uuid = ?' : ''}`)
      .get(since, ...sArg) as { n: number }).n
    const health = queryStoreHealth(now)
    const recent = queryOperations({ limit: 10, store })
    const customers = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    const newCustomers = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?').get(since) as { n: number }).n
    const failedDocs = (db.prepare(`
      SELECT COUNT(*) AS n FROM evotor_docs WHERE received_at >= ? AND status='FAILED' ${store ? 'AND store_uuid = ?' : ''}
    `).get(since, ...sArg) as { n: number }).n
    const pendingOutbox = (db.prepare(`
      SELECT COUNT(*) AS n FROM evotor_outbox WHERE status='PENDING'
    `).get() as { n: number }).n
    let quality = { noPhoto: 0, noCategory: 0, noLink: 0 }
    try {
      quality = {
        noPhoto: (db.prepare(`SELECT COUNT(*) AS n FROM products WHERE available=1 AND (image_url IS NULL OR TRIM(image_url)='')`).get() as { n: number }).n,
        noCategory: (db.prepare(`SELECT COUNT(*) AS n FROM products WHERE available=1 AND category_id IS NULL`).get() as { n: number }).n,
        noLink: (db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE p.available=1 AND NOT EXISTS (SELECT 1 FROM product_store_links l WHERE l.product_id=p.id AND l.evotor_uuid IS NOT NULL)`).get() as { n: number }).n,
      }
    } catch { /* */ }
    const exceptions: { id: string; level: string; title: string; href: string; count: number }[] = []
    if (docs.sellFailed + docs.paybackFailed + failedDocs > 0) {
      exceptions.push({ id: 'failed_docs', level: 'bad', title: 'Чеки с ошибкой обработки', href: '/operations?view=errors', count: docs.sellFailed + docs.paybackFailed + failedDocs })
    }
    if (noCard > 0) {
      exceptions.push({ id: 'nocard', level: 'warn', title: 'Продажи без карты лояльности', href: '/operations?view=nocard', count: noCard })
    }
    if (pendingOutbox > 0) {
      exceptions.push({ id: 'outbox', level: 'warn', title: 'Очередь синхронизации товаров', href: '/cash', count: pendingOutbox })
    }
    if (quality.noPhoto > 0) {
      exceptions.push({ id: 'nophoto', level: 'warn', title: 'Товары без фото', href: '/menu', count: quality.noPhoto })
    }
    const revenueSource = 'loyalty_ops_and_evotor_docs'
    const coverageNote = 'Выручка и средний чек считаются по документам/операциям, полученным интеграцией 6.7, а не по полной кассе Эвотор.'
    return c.json({
      now, period, since, store: store ?? null, health, docs, ops,
      sellWithoutCard: noCard, customers, newCustomers, recent: recent.ops,
      exceptions, quality, failedDocs, pendingOutbox,
      coverage: { source: revenueSource, note: coverageNote, complete: false },
      asOf: now,
    })
  })

  /** Business event feed for admin (read-only aggregate). */
  .get('/business-events', (c) => {
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 40)))
    const events: { at: number; kind: string; title: string; ref?: string }[] = []
    const docs = db.prepare(`
      SELECT received_at AS at, type, status, doc_id AS docId, store_uuid AS store, last_error AS err
      FROM evotor_docs ORDER BY received_at DESC LIMIT ?
    `).all(limit) as { at: number; type: string; status: string; docId: string; store: string; err: string | null }[]
    for (const d of docs) {
      events.push({
        at: d.at,
        kind: `doc_${d.status.toLowerCase()}`,
        title: `${d.type} ${d.status}${d.err ? ': ' + String(d.err).slice(0, 80) : ''}`,
        ref: `${d.store}/${d.docId}`,
      })
    }
    const ops = db.prepare(`
      SELECT created_at AS at, kind, doc_id AS docId, cups_counted AS cups, result_rub AS rub
      FROM loyalty_ops ORDER BY created_at DESC LIMIT ?
    `).all(Math.ceil(limit / 2)) as { at: number; kind: string; docId: string; cups: number; rub: number }[]
    for (const o of ops) {
      events.push({
        at: typeof o.at === 'number' ? o.at : Date.parse(String(o.at)) || 0,
        kind: 'loyalty_' + o.kind.toLowerCase(),
        title: `Лояльность ${o.kind}: ${o.cups} ст. · ${o.rub} ₽`,
        ref: o.docId,
      })
    }
    events.sort((a, b) => b.at - a.at)
    return c.json({ events: events.slice(0, limit) })
  })

  // ---------- operations journal ----------
  .get('/operations.csv', (c) => {
    const { ops } = queryOperations(opsQueryFrom(c, 5000, false))
    const csv = toCsv(
      [
        { key: 'time', title: 'Время (UTC)' }, { key: 'store', title: 'Точка' }, { key: 'type', title: 'Тип' },
        { key: 'status', title: 'Статус' }, { key: 'number', title: 'Номер чека' }, { key: 'card', title: 'Карта' },
        { key: 'cups', title: 'Чашек' }, { key: 'free', title: 'Бесплатных' }, { key: 'cashback', title: 'Кэшбэк списан, коп.' },
        { key: 'rub', title: 'Сумма чека, руб.' }, { key: 'doc', title: 'Документ' }, { key: 'error', title: 'Ошибка' },
      ],
      ops.map((o) => ({
        time: new Date(Number(o.closedAt)).toISOString().replace('T', ' ').slice(0, 19),
        store: o.storeName ?? o.storeUuid, type: o.type, status: o.status, number: o.number, card: o.cardCode,
        cups: o.cups, free: o.free, cashback: o.cashbackKopecks, rub: o.resultRub, doc: o.docId, error: o.lastError,
      })),
    )
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="operations.csv"' } })
  })

  .get('/operations', (c) => {
    const limit = Math.min(100, Math.max(1, num(c.req.query('limit')) ?? 50))
    return c.json(queryOperations(opsQueryFrom(c, limit)))
  })

  .get('/operations/:store/:doc', (c) => {
    const store = c.req.param('store')
    const doc = c.req.param('doc')
    const row = db.prepare(`${OPS_SELECT} WHERE d.store_uuid = ? AND d.doc_id = ?`).get(store, doc) as Record<string, unknown> | undefined
    if (!row) throw bad('Документ не найден', 404)
    const raw = db.prepare('SELECT wl_json AS wl FROM evotor_docs WHERE store_uuid=? AND doc_id=?').get(store, doc) as { wl: string | null }
    let positions: unknown = null
    try { positions = raw.wl ? JSON.parse(raw.wl) : null } catch { positions = null }
    return c.json({ op: row, documentData: positions })
  })

  // ---------- customers ----------
  .get('/customers', (c) => {
    const limit = Math.min(100, Math.max(1, num(c.req.query('limit')) ?? 50))
    const offset = Math.max(0, num(c.req.query('offset')) ?? 0)
    const sorts: Record<string, string> = { created: 'u.id', paid: 'paidTotal', cups: 'cups', cashback: 'u.cashback_balance', referrals: 'referrals' }
    const sort = sorts[c.req.query('sort') ?? ''] ?? 'u.id'
    const dir = c.req.query('dir') === 'asc' ? 'ASC' : 'DESC'
    const q = (c.req.query('q') ?? '').trim()
    let where = ''
    const args: unknown[] = []
    if (q) {
      if (/^\d+$/.test(q)) { where = 'WHERE (u.card_code = ? OR u.id = ?)'; args.push(q, Number(q)) }
      else { where = `WHERE (u.nickname LIKE ? ESCAPE '\\' OR u.card_code LIKE ? ESCAPE '\\' OR u.invite_code = ?)`; const l = '%' + likeEscape(q) + '%'; args.push(l, likeEscape(q) + '%', q) }
    }
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).get(...args) as { n: number }).n
    const rows = db.prepare(`
      SELECT u.id, u.nickname, u.card_code AS cardCode, u.invite_code AS inviteCode, u.invited_by AS invitedBy,
             u.cashback_balance AS cashbackBalance, u.created_at AS createdAt,
             COALESCE(cd.paid_total,0) AS paidTotal, COALESCE(cd.free_used,0) AS freeUsed,
             (SELECT COALESCE(SUM(lo.cups_counted),0) FROM loyalty_ops lo WHERE lo.card_id = u.card_id AND lo.kind='SELL') AS cups,
             (SELECT COUNT(*) FROM users r WHERE r.invited_by = u.id) AS referrals
      FROM users u LEFT JOIN cards cd ON cd.user_id = u.id
      ${where} ORDER BY ${sort} ${dir}, u.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
    return c.json({ customers: rows, total, limit, offset })
  })

  .get('/customers/:id', (c) => {
    const id = Number(c.req.param('id'))
    const u = db.prepare(`
      SELECT u.id, u.nickname, u.card_id AS cardId, u.card_code AS cardCode, u.invite_code AS inviteCode, u.invited_by AS invitedBy,
             u.cashback_balance AS cashbackBalance, u.created_at AS createdAt, u.phone,
             COALESCE(cd.paid_total,0) AS paidTotal, COALESCE(cd.free_used,0) AS freeUsed, COALESCE(cd.seq,0) AS seq
      FROM users u LEFT JOIN cards cd ON cd.user_id = u.id WHERE u.id = ?`).get(id) as (Record<string, unknown> & { cardId: string | null; invitedBy: number | null; phone: string; cardCode: string | null }) | undefined
    if (!u) throw bad('Клиент не найден', 404)
    const { phone, ...user } = u
    const cardId = u.cardId
    const ops = cardId
      ? db.prepare(`
          SELECT o.doc_store AS storeUuid, s.name AS storeName, o.doc_id AS docId, o.kind, o.cups_counted AS cups, o.free,
                 o.cb AS cashbackKopecks, o.result_rub AS resultRub, o.created_at AS createdAt
          FROM loyalty_ops o LEFT JOIN evotor_stores s ON s.store_uuid = o.doc_store
          WHERE o.card_id = ? ORDER BY o.created_at DESC LIMIT 50`).all(cardId) as { cups: number | null; kind: string }[]
      : []
    const cashback = db.prepare(`
      SELECT l.id, l.amount, l.receipt_id AS receiptId, l.created_at AS createdAt, l.from_user_id AS fromUserId, f.nickname AS fromNickname
      FROM cashback_ledger l LEFT JOIN users f ON f.id = l.from_user_id
      WHERE l.beneficiary_id = ? ORDER BY l.id DESC LIMIT 50`).all(id)
    const vouchers = db.prepare(`
      SELECT id, title, kind, value, expires_day AS expiresDay, used_at AS usedAt FROM vouchers WHERE user_id = ? ORDER BY id DESC LIMIT 50`).all(id)
    const referrals = db.prepare(`
      SELECT r.id, r.nickname, r.card_code AS cardCode, r.created_at AS createdAt, COALESCE(cd.paid_total,0) AS paidTotal
      FROM users r LEFT JOIN cards cd ON cd.user_id = r.id WHERE r.invited_by = ? ORDER BY r.id DESC LIMIT 100`).all(id)
    const invitedBy = u.invitedBy
      ? db.prepare('SELECT id, nickname, card_code AS cardCode FROM users WHERE id = ?').get(u.invitedBy)
      : null
    const receipts = db.prepare(`SELECT id, amount, dp, df, dcb, ts FROM receipts WHERE user_id = ? ORDER BY ts DESC LIMIT 20`).all(id)
    let blocked = false
    if (cardId) blocked = !!db.prepare('SELECT 1 FROM card_denylist WHERE card_id = ? AND released_at IS NULL').get(cardId)

    // Plain-language hints, derived only from the data above.
    const hints: string[] = []
    if (blocked) hints.push('Карта заблокирована (стоп-лист): касса её не принимает.')
    if (!ops.length) hints.push('За этой картой нет ни одной операции с кассы Эвотор.')
    const zero = ops.filter((o) => o.kind === 'SELL' && !o.cups).length
    if (zero) hints.push(`Операций без начисленных чашек: ${zero}. Проверьте, что у проданных товаров стоит «считается чашкой».`)
    hints.push('Карта, введённая на кассе вручную по номеру, не резервирует бонусы (кэшбэк и бесплатные позиции) — так устроено.')

    return c.json({
      user, hasPhone: !String(phone).startsWith('guest:'), blocked, invitedBy,
      ops, cashback, vouchers, referrals, receipts, hints,
    })
  })

  // Real phone number only on an explicit request (and it is written to the audit journal).
  .get('/customers/:id/phone', (c) => {
    const id = Number(c.req.param('id'))
    const role = (c as unknown as { get: (k: string) => string | undefined }).get('adminRole') || 'owner'
    // A read-only token must not reveal personal data.
    if (role === 'viewer') throw bad('Недостаточно прав для просмотра телефона', 403)
    const u = db.prepare('SELECT phone FROM users WHERE id = ?').get(id) as { phone: string } | undefined
    if (!u) throw bad('Клиент не найден', 404)
    if (String(u.phone).startsWith('guest:')) return c.json({ phone: null })
    // The audit middleware only records mutating calls, so this GET writes its own row (who looked at a phone, and when).
    writeAudit({
      method: 'GET', path: c.req.path, status: 200, entity: 'customers', entityId: String(id),
      summary: 'Показан номер телефона клиента', actor: role,
      ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    })
    return c.json({ phone: u.phone })
  })

  // ---------- vouchers ----------
  .get('/voucher-templates', (c) =>
    c.json({ templates: db.prepare('SELECT id, code, title, kind, value, valid_days AS validDays FROM voucher_templates ORDER BY id').all() }))

  .get('/vouchers/grant-all/preview', (c) => {
    const code = c.req.query('code') ?? ''
    const t = db.prepare('SELECT id, code, title, kind, value, valid_days AS validDays FROM voucher_templates WHERE code = ?').get(code)
    if (!t) throw bad('Шаблон ваучера не найден', 404)
    const users = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    return c.json({ template: t, users })
  })

  .post('/customers/:id/vouchers', zValidator('json', z.object({ code: z.string().min(1).max(64) })), (c) => {
    const id = Number(c.req.param('id'))
    const { code } = c.req.valid('json')
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(id)) throw bad('Клиент не найден', 404)
    const t = db.prepare('SELECT title FROM voucher_templates WHERE code = ?').get(code) as { title: string } | undefined
    if (!t) throw bad('Шаблон ваучера не найден', 404)
    grantVoucher(id, code)
    c.set('audit', { entity: 'customers', entityId: String(id), summary: `Выдан ваучер «${t.title}»`, after: { code } })
    return c.json({ ok: true })
  })

  /**
   * 3.3 Ручная корректировка лояльности. Только владелец: это деньги и прогресс гостя.
   * Пишет строку `loyalty_ledger` с operation='ADJUSTMENT' и аудит с причиной,
   * старыми и новыми значениями. Отрицательные итоги клампятся в 0, в ledger идёт факт.
   */
  .post(
    '/customers/:id/loyalty-adjust',
    zValidator(
      'json',
      z
        .object({
          cupsDelta: z.number().int().min(-1000).max(1000).optional(),
          freeUsedDelta: z.number().int().min(-1000).max(1000).optional(),
          cashbackDeltaKop: z.number().int().min(-1_000_000).max(1_000_000).optional(),
          reason: z.string().trim().min(3, 'Укажите причину (минимум 3 символа)').max(500),
        })
        .refine(
          (v) => Boolean(v.cupsDelta || v.freeUsedDelta || v.cashbackDeltaKop),
          { message: 'Укажите хотя бы одну корректировку' },
        ),
    ),
    (c) => {
      const role = c.get('adminRole' as never) as string | undefined
      if (role !== 'owner') throw bad('Корректировку баланса может делать только владелец', 403)

      const id = Number(c.req.param('id'))
      if (!Number.isInteger(id) || id <= 0) throw bad('Некорректный клиент', 400)
      const body = c.req.valid('json')
      const user = db
        .prepare('SELECT id, card_id AS cardId, cashback_balance AS cashback FROM users WHERE id=?')
        .get(id) as { id: number; cardId: string | null; cashback: number } | undefined
      if (!user) throw bad('Клиент не найден', 404)
      if (!user.cardId) throw bad('У клиента нет карты лояльности', 400)
      const cardId = user.cardId

      const applied = db.transaction(() => {
        const cards = db
          .prepare('SELECT paid_total AS paidTotal, free_used AS freeUsed FROM cards WHERE user_id=?')
          .get(id) as { paidTotal: number; freeUsed: number } | undefined
        const before = {
          paidTotal: cards?.paidTotal ?? 0,
          freeUsed: cards?.freeUsed ?? 0,
          cashback: user.cashback,
        }
        const after = {
          paidTotal: Math.max(0, before.paidTotal + (body.cupsDelta ?? 0)),
          freeUsed: Math.max(0, before.freeUsed + (body.freeUsedDelta ?? 0)),
          cashback: Math.max(0, before.cashback + (body.cashbackDeltaKop ?? 0)),
        }
        const actual = {
          cupsDelta: after.paidTotal - before.paidTotal,
          freeUsedDelta: after.freeUsed - before.freeUsed,
          cashbackDeltaKop: after.cashback - before.cashback,
        }
        // Нечего применять (всё срезано клампом) — отвечаем 400, чтобы не плодить пустые записи.
        if (!actual.cupsDelta && !actual.freeUsedDelta && !actual.cashbackDeltaKop) {
          throw bad('Корректировка не применена: итог не может быть отрицательным', 400)
        }

        const t = Date.now()
        db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, t)
        db.prepare('UPDATE cards SET paid_total=?, free_used=?, updated_at=? WHERE user_id=?').run(
          after.paidTotal,
          after.freeUsed,
          t,
          id,
        )
        db.prepare('UPDATE users SET cashback_balance=? WHERE id=?').run(after.cashback, id)
        db.prepare(
          `INSERT INTO loyalty_ledger(card_id, operation, cups_delta, free_delta, cashback_delta, source_type, source_id, created_at)
           VALUES(?, 'ADJUSTMENT', ?, ?, ?, 'ADMIN_ADJUST', ?, ?)`,
        ).run(cardId, actual.cupsDelta, actual.freeUsedDelta, actual.cashbackDeltaKop, `adj:${randomUUID()}`, t)
        log.info('loyalty manual adjust', {
          user: id,
          actual,
          requested: {
            cupsDelta: body.cupsDelta ?? 0,
            freeUsedDelta: body.freeUsedDelta ?? 0,
            cashbackDeltaKop: body.cashbackDeltaKop ?? 0,
          },
        })
        return { before, after, actual }
      })()

      c.set('audit', {
        entity: 'customers',
        entityId: String(id),
        summary: `Корректировка лояльности: ${body.reason}`,
        before: applied.before,
        after: { ...applied.after, reason: body.reason, applied: applied.actual },
      })
      return c.json({ ok: true, card: applied.after, applied: applied.actual, reason: body.reason })
    },
  )

  /* ---------- 3.4 сбойные документы лояльности ---------- */

  /** Список FAILED-документов с телом, сохранённым для повтора. */
  .get('/loyalty/failed', (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50)))
    const rows = db
      .prepare(
        `SELECT d.store_uuid AS storeUuid, s.name AS storeName, d.doc_id AS docId, d.type, d.status,
                d.attempts, d.last_error AS lastError, d.next_retry_at AS nextRetryAt, d.close_date_ms AS closeDateMs,
                CASE WHEN d.raw_json IS NULL THEN 0 ELSE 1 END AS hasRaw
         FROM evotor_docs d LEFT JOIN evotor_stores s ON s.store_uuid = d.store_uuid
         WHERE d.status='FAILED'
         ORDER BY d.close_date_ms DESC LIMIT ?`,
      )
      .all(limit)
    return c.json({ docs: rows })
  })

  /** Повторить обработку одного документа: сначала сохранённый raw, затем окно Cloud. */
  .post('/loyalty/failed/:docId/retry', async (c) => {
    const docId = (c.req.param('docId') ?? '').slice(0, 120)
    const storeUuid = (c.req.query('storeUuid') ?? '').slice(0, 64)
    if (!docId || !storeUuid) throw bad('Нужны docId и storeUuid', 400)
    c.set('audit', {
      entity: 'loyalty_failed',
      entityId: docId,
      summary: `Повтор обработки документа ${docId}`,
    })
    const { PollService } = await import('../../integrations/evotor/sync/PollService')
    const result = await new PollService(db).retryDocument(storeUuid, docId)
    if (result.status === 'MISSING') throw bad('Документ не найден', 404)
    log.info('loyalty failed doc retry', { docId, storeUuid, ok: result.ok, status: result.status })
    return c.json({ ok: result.ok, status: result.status, reason: result.reason ?? null })
  })

  // ---------- products: partial + bulk edits ----------
  .patch('/products/:id', zValidator('json', patchFields.extend({
    expectedUpdatedAt: z.number().int().nullable().optional(),
  })), (c) => {
    const id = Number(c.req.param('id'))
    const body = c.req.valid('json')
    if (priceModes(body) > 1) throw bad('Укажите только один способ изменения цены')
    const row = db.prepare(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ?`).get(id) as ProductRow | undefined
    if (!row) throw bad('Товар не найден', 404)
    if (body.expectedUpdatedAt != null && (row.updated_at ?? 0) !== body.expectedUpdatedAt) {
      throw bad('Товар уже изменён кем-то другим — обновите страницу', 409)
    }
    if (body.categoryId != null && !db.prepare('SELECT id FROM categories WHERE id = ?').get(body.categoryId)) throw bad('Группа не найдена', 404)
    const changes = diffProduct(row, body)
    if (!changes.length) return c.json({ ok: true, changed: 0, updatedAt: row.updated_at })
    const now = Date.now()
    setProductFields(id, changes, now)
    enqueueProductSync([id])
    c.set('audit', {
      entity: 'products', entityId: String(id), summary: `Товар «${row.name}»: ${changes.map((x) => x.field).join(', ')}`,
      before: Object.fromEntries(changes.map((x) => [x.field, x.from])), after: Object.fromEntries(changes.map((x) => [x.field, x.to])),
    })
    return c.json({ ok: true, changed: changes.length, updatedAt: now })
  })

  .post('/products/bulk', zValidator('json', z.object({
    ids: z.array(z.number().int().positive()).min(1).max(500),
    patch: patchFields.optional(),
    stores: z.object({ enable: z.array(z.string().min(1)).optional(), disable: z.array(z.string().min(1)).optional() }).optional(),
    dryRun: z.boolean().default(false),
  })), (c) => {
    const { patch, stores, dryRun } = c.req.valid('json')
    const ids = [...new Set(c.req.valid('json').ids)]
    const p: ProductPatch = patch ?? {}
    if (patch && priceModes(patch) > 1) throw bad('Укажите только один способ изменения цены')
    const hasPatch = !!patch && Object.values(patch).some((v) => v !== undefined)
    const storeEnable = [...new Set(stores?.enable ?? [])]
    const storeDisable = [...new Set(stores?.disable ?? [])].filter((s) => !storeEnable.includes(s))
    if (!hasPatch && !storeEnable.length && !storeDisable.length) throw bad('Нечего менять')
    if (p.categoryId != null && !db.prepare('SELECT id FROM categories WHERE id = ?').get(p.categoryId)) throw bad('Группа не найдена', 404)
    for (const s of [...storeEnable, ...storeDisable]) {
      if (!db.prepare('SELECT store_uuid FROM evotor_stores WHERE store_uuid = ?').get(s)) throw bad('Точка не найдена: ' + s.slice(0, 8), 404)
    }
    const rows = ids.map((id) => db.prepare(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ?`).get(id) as ProductRow | undefined)
    const missing = ids.filter((_, i) => !rows[i])
    if (missing.length) throw bad('Товары не найдены: ' + missing.slice(0, 10).join(', '), 404)

    const plan = (rows as ProductRow[]).map((r) => ({ id: r.id, name: r.name, changes: hasPatch ? diffProduct(r, p) : [] }))
    const result = {
      dryRun, products: plan.length,
      changedProducts: plan.filter((x) => x.changes.length).length,
      stores: { enable: storeEnable, disable: storeDisable },
      plan: plan.map((x) => ({ id: x.id, name: x.name, changes: x.changes })),
    }
    if (dryRun) return c.json({ ok: true, ...result })

    const now = Date.now()
    db.transaction(() => {
      for (const x of plan) if (x.changes.length) setProductFields(x.id, x.changes, now)
      if (storeEnable.length || storeDisable.length) {
        for (const id of ids) {
          for (const s of storeEnable) {
            db.prepare(`INSERT INTO product_store_links(product_id, store_uuid, enabled, updated_at) VALUES(?,?,1,?)
                        ON CONFLICT(product_id, store_uuid) DO UPDATE SET enabled=1, updated_at=excluded.updated_at, last_error=NULL`).run(id, s, now)
          }
          for (const s of storeDisable) {
            db.prepare(`UPDATE product_store_links SET enabled=0, updated_at=? WHERE product_id=? AND store_uuid=?`).run(now, id, s)
          }
        }
      }
    })()
    const touched = plan.filter((x) => x.changes.length).map((x) => x.id)
    enqueueProductSync(storeEnable.length || storeDisable.length ? ids : touched)
    c.set('audit', {
      entity: 'products', entityId: null,
      summary: `Массовая правка: ${ids.length} товаров, изменено ${result.changedProducts}`,
      after: { patch: patch ?? null, stores: result.stores, ids: ids.slice(0, 50), sample: result.plan.filter((x) => x.changes.length).slice(0, 20) },
    })
    return c.json({ ok: true, ...result })
  })

  .get('/products.csv', (c) => {
    const rows = db.prepare(`
      SELECT p.id, p.name, c.name AS category, p.price, p.available, p.counts_as_cup AS cup, p.free_eligible AS freeEligible,
             p.tax, p.measure, p.cost_price_kopecks AS cost, p.updated_at AS updatedAt,
             (SELECT COUNT(*) FROM product_store_links l WHERE l.product_id = p.id AND COALESCE(l.enabled,1)=1) AS stores,
             (SELECT COUNT(*) FROM product_store_links l WHERE l.product_id = p.id AND l.last_error IS NOT NULL AND l.last_error != '') AS syncErrors
      FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.sort_order, p.id`).all() as Record<string, unknown>[]
    const csv = toCsv(
      [
        { key: 'id', title: 'ID' }, { key: 'name', title: 'Название' }, { key: 'category', title: 'Группа' },
        { key: 'price', title: 'Цена, руб.' }, { key: 'available', title: 'В продаже' }, { key: 'cup', title: 'Считается чашкой' },
        { key: 'freeEligible', title: 'Бесплатная позиция' }, { key: 'tax', title: 'Налог' }, { key: 'measure', title: 'Ед.' },
        { key: 'cost', title: 'Себестоимость, коп.' }, { key: 'stores', title: 'Точек' }, { key: 'syncErrors', title: 'Ошибок выгрузки' },
        { key: 'updated', title: 'Изменён (UTC)' },
      ],
      rows.map((r) => ({
        ...r, available: r.available ? 'да' : 'нет', cup: r.cup ? 'да' : 'нет', freeEligible: r.freeEligible ? 'да' : 'нет',
        updated: r.updatedAt ? new Date(Number(r.updatedAt)).toISOString().replace('T', ' ').slice(0, 19) : '',
      })),
    )
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="products.csv"' } })
  })

  // ---------- audit journal ----------
  .get('/audit', (c) => {
    const limit = Math.min(100, Math.max(1, num(c.req.query('limit')) ?? 50))
    const w: string[] = []
    const a: unknown[] = []
    const entity = c.req.query('entity')
    if (entity) { w.push('entity = ?'); a.push(entity) }
    if (c.req.query('onlyErrors') === '1') w.push('ok = 0')
    const from = num(c.req.query('from')); if (from !== undefined) { w.push('at >= ?'); a.push(from) }
    const to = num(c.req.query('to')); if (to !== undefined) { w.push('at <= ?'); a.push(to) }
    const cur = decodeCursor(c.req.query('cursor'))
    if (cur) { w.push('(at < ? OR (at = ? AND id < ?))'); a.push(cur.t, cur.t, Number(cur.id)) }
    const rows = db.prepare(`
      SELECT id, at, actor, method, path, status, ok, entity, entity_id AS entityId, summary,
             before_json AS before, after_json AS after, ip
      FROM admin_audit ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY at DESC, id DESC LIMIT ?`).all(...a, limit + 1) as { id: number; at: number }[]
    const more = rows.length > limit
    const page = more ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    return c.json({ entries: page, next: more && last ? encodeCursor(last.at, String(last.id)) : null })
  })

// keep unused-import linters quiet for helpers re-exported for tests
export { nextPrice }
