/**
 * Staff / timesheet / wishes / breaks — shared queries for device + admin APIs.
 * No demo rows: empty DB ⇒ empty honest responses.
 */
import { db } from '../../db'

export function storeUuidFrom(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }) {
  return (c.req.query('storeUuid') || c.req.header('X-Evotor-Store-Uuid') || '').slice(0, 80) || null
}

export function deviceUuidFrom(c: { req: { header: (n: string) => string | undefined } }) {
  return (c.req.header('X-Evotor-Device-UUID') || '').slice(0, 80) || null
}

/** Resolve internal store id from Evotor store uuid if present. */
export function storeIdForUuid(storeUuid: string | null): number | null {
  if (!storeUuid) return null
  try {
    const row = db.prepare(`SELECT id FROM stores WHERE evotor_uuid=? OR uuid=? LIMIT 1`).get(storeUuid, storeUuid) as { id: number } | undefined
    if (row) return row.id
  } catch { /* columns may differ */ }
  try {
    const row = db.prepare(`SELECT store_id AS id FROM devices WHERE revoked=0 LIMIT 1`).get() as { id: number } | undefined
    return row?.id ?? null
  } catch {
    return null
  }
}

export function listStaff(storeUuid: string | null, storeId: number | null) {
  try {
    if (storeUuid) {
      return db.prepare(
        `SELECT id, name, role, active, store_uuid AS storeUuid FROM staff_members WHERE active=1 AND (store_uuid=? OR store_uuid IS NULL OR store_uuid='') ORDER BY id`,
      ).all(storeUuid) as { id: number; name: string; role: string; active: number; storeUuid: string | null }[]
    }
    if (storeId != null) {
      return db.prepare(
        `SELECT id, name, role, active, store_uuid AS storeUuid FROM staff_members WHERE active=1 AND (store_id=? OR store_id IS NULL) ORDER BY id`,
      ).all(storeId) as { id: number; name: string; role: string; active: number; storeUuid: string | null }[]
    }
    return db.prepare(
      `SELECT id, name, role, active, store_uuid AS storeUuid FROM staff_members WHERE active=1 ORDER BY id`,
    ).all() as { id: number; name: string; role: string; active: number; storeUuid: string | null }[]
  } catch {
    return []
  }
}

export function staffForDevice(deviceUuid: string | null, storeUuid: string | null, storeId: number | null) {
  if (deviceUuid) {
    try {
      const link = db.prepare(`SELECT staff_id AS id FROM staff_device_link WHERE device_uuid=?`).get(deviceUuid) as { id: number } | undefined
      if (link) {
        const s = db.prepare(`SELECT id, name, role FROM staff_members WHERE id=? AND active=1`).get(link.id) as { id: number; name: string; role: string } | undefined
        if (s) return s
      }
    } catch { /* no table yet mid-migrate */ }
  }
  const all = listStaff(storeUuid, storeId)
  return all[0] ?? null
}

export function dayKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function monthPrefix(month: string) {
  // YYYY-MM
  return month.slice(0, 7)
}

export function salesSummary(storeUuid: string | null, sinceMs: number) {
  try {
    if (storeUuid) {
      const r = db.prepare(`
        SELECT COUNT(DISTINCT doc_id) AS receipts,
               COALESCE(SUM(sum_kopecks),0) AS revenue
        FROM sales_lines
        WHERE store_uuid=? AND closed_at IS NOT NULL AND closed_at>=?
      `).get(storeUuid, sinceMs) as { receipts: number; revenue: number }
      return { receiptsCount: r.receipts || 0, revenueKopecks: r.revenue || 0 }
    }
    const r = db.prepare(`
      SELECT COUNT(DISTINCT doc_id) AS receipts,
             COALESCE(SUM(sum_kopecks),0) AS revenue
      FROM sales_lines
      WHERE closed_at IS NOT NULL AND closed_at>=?
    `).get(sinceMs) as { receipts: number; revenue: number }
    return { receiptsCount: r.receipts || 0, revenueKopecks: r.revenue || 0 }
  } catch {
    return { receiptsCount: 0, revenueKopecks: 0 }
  }
}

export function hourlySales(storeUuid: string | null, sinceMs: number) {
  try {
    const rows = storeUuid
      ? db.prepare(`
          SELECT CAST(strftime('%H', closed_at/1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                 COALESCE(SUM(sum_kopecks),0) AS revenueKopecks
          FROM sales_lines
          WHERE store_uuid=? AND closed_at>=? AND closed_at IS NOT NULL
          GROUP BY hour ORDER BY hour
        `).all(storeUuid, sinceMs)
      : db.prepare(`
          SELECT CAST(strftime('%H', closed_at/1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                 COALESCE(SUM(sum_kopecks),0) AS revenueKopecks
          FROM sales_lines
          WHERE closed_at>=? AND closed_at IS NOT NULL
          GROUP BY hour ORDER BY hour
        `).all(sinceMs)
    return rows as { hour: number; revenueKopecks: number }[]
  } catch {
    return []
  }
}

export function topProducts(storeUuid: string | null, sinceMs: number, limit = 3) {
  try {
    const rows = storeUuid
      ? db.prepare(`
          SELECT COALESCE(name_snapshot,'(без названия)') AS name, SUM(qty) AS qty
          FROM sales_lines
          WHERE store_uuid=? AND closed_at>=? AND closed_at IS NOT NULL
          GROUP BY name ORDER BY qty DESC LIMIT ?
        `).all(storeUuid, sinceMs, limit)
      : db.prepare(`
          SELECT COALESCE(name_snapshot,'(без названия)') AS name, SUM(qty) AS qty
          FROM sales_lines
          WHERE closed_at>=? AND closed_at IS NOT NULL
          GROUP BY name ORDER BY qty DESC LIMIT ?
        `).all(sinceMs, limit)
    return (rows as { name: string; qty: number }[]).map((r) => ({ name: r.name, qty: Math.round(r.qty) }))
  } catch {
    return []
  }
}
