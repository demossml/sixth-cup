/**
 * Admin analytics: time series + by-store breakdown.
 * Numbers are 6.7 ops / polled docs — not full Evotor fiscal report.
 */
import { Hono } from 'hono'
import { db } from '../../db'
import { periodSince } from './consoleLib'

const DAY = 24 * 60 * 60 * 1000

function toMs(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
    const p = Date.parse(v)
    return Number.isFinite(p) ? p : 0
  }
  return 0
}

function periodBounds(period: string | undefined, now: number): { since: number; until: number; period: string } {
  const p = periodSince(period, now)
  return { since: p.since, until: p.until ?? now, period: p.period }
}

function bucketKey(ms: number, grain: 'hour' | 'day'): string {
  const d = new Date(ms)
  if (grain === 'hour') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}`
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function emptyPoint(t: string) {
  return { t, sellDocs: 0, sellWithCard: 0, cups: 0, revenueRub: 0, cashbackKop: 0, free: 0 }
}

/** `sync_enabled` is added lazily by the Evotor modules, so ensure it exists before querying stores. */
function ensureStoresSyncColumn() {
  const cols = db.prepare(`PRAGMA table_info(evotor_stores)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'sync_enabled')) {
    db.exec(`ALTER TABLE evotor_stores ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 0`)
  }
}

export const adminAnalytics = new Hono()
  .get('/analytics/series', (c) => {
    ensureStoresSyncColumn()
    const now = Date.now()
    const { since, until, period } = periodBounds(c.req.query('period'), now)
    const store = c.req.query('storeUuid') || c.req.query('store') || undefined
    const grainParam = c.req.query('grain')
    const grain: 'hour' | 'day' =
      grainParam === 'hour' || grainParam === 'day'
        ? grainParam
        : period === '24h' || period === 'yesterday'
          ? 'hour'
          : 'day'

    const map = new Map<string, ReturnType<typeof emptyPoint>>()

    const docSql = `
      SELECT received_at AS at, type, status FROM evotor_docs
      WHERE received_at >= ? AND received_at < ? AND type = 'SELL'
      ${store ? 'AND store_uuid = ?' : ''}
    `
    const docs = db.prepare(docSql).all(since, until, ...(store ? [store] : [])) as {
      at: number
      type: string
      status: string
    }[]
    for (const d of docs) {
      const t = bucketKey(toMs(d.at), grain)
      const p = map.get(t) ?? emptyPoint(t)
      p.sellDocs += 1
      map.set(t, p)
    }

    const opsSql = `
      SELECT created_at AS at, kind, cups_counted AS cups, free, cb, result_rub AS rub
      FROM loyalty_ops
      WHERE kind = 'SELL'
      ${store ? 'AND doc_store = ?' : ''}
    `
    // Filter by time in JS — created_at may be ms number or text
    const opsAll = db.prepare(opsSql).all(...(store ? [store] : [])) as {
      at: unknown
      kind: string
      cups: number
      free: number
      cb: number
      rub: number
    }[]
    for (const o of opsAll) {
      const at = toMs(o.at)
      if (at < since || at >= until) continue
      const t = bucketKey(at, grain)
      const p = map.get(t) ?? emptyPoint(t)
      p.sellWithCard += 1
      p.cups += Number(o.cups) || 0
      p.free += Number(o.free) || 0
      p.cashbackKop += Number(o.cb) || 0
      p.revenueRub += Number(o.rub) || 0
      map.set(t, p)
    }

    // Fill empty buckets for continuous axis
    const points: ReturnType<typeof emptyPoint>[] = []
    // Start on a bucket boundary so the final (partial) hour/day is included, not dropped.
    if (grain === 'hour') {
      const step = 60 * 60 * 1000
      for (let t = Math.floor(since / step) * step; t < until; t += step) {
        const k = bucketKey(t, 'hour')
        points.push(map.get(k) ?? emptyPoint(k))
      }
    } else {
      for (let t = Math.floor(since / DAY) * DAY; t < until; t += DAY) {
        const k = bucketKey(t, 'day')
        points.push(map.get(k) ?? emptyPoint(k))
      }
    }

    const totals = points.reduce(
      (a, p) => ({
        sellDocs: a.sellDocs + p.sellDocs,
        sellWithCard: a.sellWithCard + p.sellWithCard,
        cups: a.cups + p.cups,
        revenueRub: a.revenueRub + p.revenueRub,
        cashbackKop: a.cashbackKop + p.cashbackKop,
        free: a.free + p.free,
      }),
      { sellDocs: 0, sellWithCard: 0, cups: 0, revenueRub: 0, cashbackKop: 0, free: 0 },
    )

    const storesIncluded = (
      db.prepare(`SELECT COUNT(*) AS n FROM evotor_stores WHERE COALESCE(sync_enabled,0)=1`).get() as { n: number }
    ).n

    return c.json({
      ok: true,
      currencyNote: 'ops_6_7_not_full_evotor',
      period,
      grain,
      since,
      until,
      storeUuid: store || null,
      points,
      totals,
      coverage: {
        storesIncluded,
        note:
          storesIncluded <= 1
            ? 'Данные по точкам с включённой синхронизацией 6.7. Выручка — по ops лояльности, не полный отчёт Эвотор.'
            : `Включено точек sync: ${storesIncluded}. Выручка — по ops 6.7, не полный кассовый отчёт Эвотор.`,
      },
    })
  })

  .get('/analytics/by-store', (c) => {
    ensureStoresSyncColumn()
    const now = Date.now()
    const { since, until, period } = periodBounds(c.req.query('period'), now)
    const stores = db
      .prepare(
        `SELECT store_uuid AS uuid, name, COALESCE(sync_enabled,0) AS enabled FROM evotor_stores ORDER BY name`,
      )
      .all() as { uuid: string; name: string; enabled: number }[]

    const rows = stores
      .filter((s) => s.enabled === 1)
      .map((s) => {
        const sellDocs = (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM evotor_docs WHERE store_uuid=? AND type='SELL' AND received_at>=? AND received_at<?`,
            )
            .get(s.uuid, since, until) as { n: number }
        ).n
        const ops = db
          .prepare(
            `SELECT COUNT(*) AS sells,
                    COALESCE(SUM(cups_counted),0) AS cups,
                    COALESCE(SUM(result_rub),0) AS revenueRub
             FROM loyalty_ops WHERE kind='SELL' AND doc_store=?`,
          )
          .get(s.uuid) as { sells: number; cups: number; revenueRub: number }
        // time filter ops
        const opsList = db
          .prepare(`SELECT created_at AS at, cups_counted AS cups, result_rub AS rub FROM loyalty_ops WHERE kind='SELL' AND doc_store=?`)
          .all(s.uuid) as { at: unknown; cups: number; rub: number }[]
        let sells = 0
        let cups = 0
        let revenueRub = 0
        for (const o of opsList) {
          const at = toMs(o.at)
          if (at < since || at >= until) continue
          sells += 1
          cups += Number(o.cups) || 0
          revenueRub += Number(o.rub) || 0
        }
        const withCardPct = sellDocs > 0 ? Math.round((sells / sellDocs) * 100) : 0
        return {
          storeUuid: s.uuid,
          name: s.name,
          sellDocs,
          sellWithCard: sells,
          cups,
          revenueRub,
          withCardPct,
        }
      })

    return c.json({
      ok: true,
      currencyNote: 'ops_6_7_not_full_evotor',
      period,
      since,
      until,
      rows,
    })
  })

  .get('/referrals/summary', (c) => {
    const now = Date.now()
    const { since, until, period } = periodBounds(c.req.query('period') || '30d', now)
    const invited = (
      db.prepare(`SELECT COUNT(*) AS n FROM users WHERE invited_by IS NOT NULL`).get() as { n: number }
    ).n
    // invited users with at least one SELL op
    const active = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT u.id) AS n FROM users u
           WHERE u.invited_by IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM loyalty_ops o
               JOIN users u2 ON u2.card_id = o.card_id
               WHERE u2.id = u.id AND o.kind='SELL'
             )`,
        )
        .get() as { n: number }
    ).n

    let bonusKop = 0
    try {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(amount),0) AS n FROM cashback_ledger
           WHERE amount > 0`,
        )
        .get() as { n: number }
      // filter by time if column exists
      bonusKop = row.n
      const cols = db.prepare(`PRAGMA table_info(cashback_ledger)`).all() as { name: string }[]
      if (cols.some((c) => c.name === 'created_at')) {
        const list = db
          .prepare(`SELECT amount, created_at AS at FROM cashback_ledger WHERE amount > 0`)
          .all() as { amount: number; at: unknown }[]
        bonusKop = 0
        for (const r of list) {
          const at = toMs(r.at)
          if (at && (at < since || at >= until)) continue
          if (!at || (at >= since && at < until)) bonusKop += Number(r.amount) || 0
        }
      }
    } catch {
      bonusKop = 0
    }

    const rows = db
      .prepare(
        `
      SELECT u.id AS inviteeId, u.card_code AS inviteeCard,
             inv.id AS inviterId, inv.card_code AS inviterCard,
             u.created_at AS createdAt
      FROM users u
      JOIN users inv ON inv.id = u.invited_by
      ORDER BY u.id DESC
      LIMIT 100
    `,
      )
      .all() as {
      inviteeId: number
      inviteeCard: string | null
      inviterId: number
      inviterCard: string | null
      createdAt: unknown
    }[]

    const table = rows.map((r) => {
      const hasPurchase = !!(
        db
          .prepare(
            `SELECT 1 AS x FROM loyalty_ops o
             JOIN users u ON u.card_id = o.card_id
             WHERE u.id = ? AND o.kind='SELL' LIMIT 1`,
          )
          .get(r.inviteeId) as { x: number } | undefined
      )
      return {
        inviterCard: r.inviterCard ? String(r.inviterCard) : '—',
        inviteeCard: r.inviteeCard ? String(r.inviteeCard) : '—',
        status: hasPurchase ? 'active' : 'pending',
        createdAt: toMs(r.createdAt) || null,
      }
    })

    return c.json({
      ok: true,
      period,
      since,
      until,
      kpi: {
        invited,
        active,
        bonusKop,
        bonusRub: Math.floor(bonusKop / 100),
      },
      rows: table,
    })
  })
