import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { evotorProxy, evotorProxyStrict } from '../../middleware/evotorProxy'
import {
  dayKey, deviceUuidFrom, hourlySales, listStaff, monthPrefix,
  salesSummary, staffForDevice, storeIdForUuid, storeUuidFrom, topProducts,
} from './service'

function parseJsonArr(s: string | null | undefined): unknown[] {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

export const staffDeviceRoutes = new Hono()
  // Same auth model as other /api/devices/* cashier endpoints:
  // soft proxy when EVOTOR_PROXY_ENFORCE is off; strict on writes.
  .use('*', evotorProxy)
  .get('/shift/summary', (c) => {
    const storeUuid = storeUuidFrom(c)
    const storeId = storeIdForUuid(storeUuid)
    const deviceUuid = deviceUuidFrom(c)
    const staff = staffForDevice(deviceUuid, storeUuid, storeId)
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const since = start.getTime()
    const sales = salesSummary(storeUuid, since)
    const avg = sales.receiptsCount > 0 ? Math.round(sales.revenueKopecks / sales.receiptsCount) : 0
    const hourly = hourlySales(storeUuid, since).map((h) => ({
      hour: h.hour,
      revenueKopecks: h.revenueKopecks,
      // Android 4.9.8 ShiftApi expects revenueRub
      revenueRub: Math.round((h.revenueKopecks || 0) / 100),
    }))
    const top = topProducts(storeUuid, since, 3)
    return c.json({
      ok: true,
      status: 'open',
      employeeName: staff?.name ?? null,
      role: staff?.role ?? null,
      openedAt: null,
      plannedEndAt: null,
      receiptsCount: sales.receiptsCount,
      revenueKopecks: sales.revenueKopecks,
      avgCheckKopecks: avg,
      cashKopecks: null,
      cardKopecks: null,
      drinksSharePct: null,
      foodSharePct: null,
      hourly,
      top,
      // --- aliases for cashier APK 4.9.8 (BACKEND-API.md) ---
      receipts: sales.receiptsCount,
      revenueRub: Math.round((sales.revenueKopecks || 0) / 100),
      avgReceiptRub: Math.round((avg || 0) / 100),
    })
  })

  .get('/shift/team', (c) => {
    const storeUuid = storeUuidFrom(c)
    const storeId = storeIdForUuid(storeUuid)
    const members = listStaff(storeUuid, storeId).map((s) => ({
      id: String(s.id),
      name: s.name,
      role: s.role,
      status: 'on_shift' as const,
      receiptsCount: null as number | null,
      revenueKopecks: null as number | null,
    }))
    // Android 4.9.8: people[] + receipts + revenueRub
    const people = members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      status: m.status,
      receipts: m.receiptsCount,
      revenueRub: m.revenueKopecks != null ? Math.round(m.revenueKopecks / 100) : null,
    }))
    return c.json({
      ok: true,
      shiftLabel: null,
      members,
      people,
    })
  })

  .get('/timesheet', (c) => {
    // APK 4.9.8 sends from/to (yyyy-MM-dd); admin/docs use month=YYYY-MM
    const fromQ = (c.req.query('from') || '').trim()
    const toQ = (c.req.query('to') || '').trim()
    const monthRaw = c.req.query('month') || (fromQ.length >= 7 ? fromQ.slice(0, 7) : dayKey().slice(0, 7))
    const month = monthPrefix(monthRaw)
    const storeUuid = storeUuidFrom(c)
    const storeId = storeIdForUuid(storeUuid)
    const staff = staffForDevice(deviceUuidFrom(c), storeUuid, storeId)
    let days: { day: number; status: string; start: string | null; end: string | null; label: string | null }[] = []
    let scheduleStatus: 'empty' | 'approved' | 'preliminary' = 'empty'
    if (staff) {
      try {
        const rows = db.prepare(`
          SELECT day, status, start_hm AS start, end_hm AS end, label
          FROM staff_schedule_days WHERE staff_id=? AND day LIKE ?
          ORDER BY day
        `).all(staff.id, `${month}-%`) as { day: string; status: string; start: string | null; end: string | null; label: string | null }[]
        days = rows.map((r) => ({
          day: Number(r.day.slice(8, 10)),
          status: r.status,
          start: r.start,
          end: r.end,
          label: r.label,
        }))
        if (days.length) {
          scheduleStatus = days.every((d) => d.status === 'work' || d.status === 'off' || d.status === 'approved')
            ? 'approved'
            : days.some((d) => d.status === 'preliminary') ? 'preliminary' : 'approved'
        }
      } catch { /* table missing */ }
    }
    let storeName = '6.7 Coffee'
    try {
      const s = storeId != null
        ? db.prepare(`SELECT name FROM stores WHERE id=?`).get(storeId) as { name: string } | undefined
        : undefined
      if (s?.name) storeName = s.name
    } catch { /* */ }
    // Dual shape: backend day:int + APK date/from/to/note
    const daysOut = days.map((d) => {
      const date = `${month}-${String(d.day).padStart(2, '0')}`
      return {
        day: d.day,
        status: d.status,
        start: d.start,
        end: d.end,
        label: d.label,
        date,
        from: d.start,
        to: d.end,
        note: d.label,
      }
    }).filter((d) => {
      if (fromQ && d.date < fromQ) return false
      if (toQ && d.date > toQ) return false
      return true
    })
    return c.json({
      ok: true,
      month,
      storeName,
      scheduleStatus,
      days: daysOut,
    })
  })

  .get('/timesheet/wishes', (c) => {
    const month = monthPrefix(c.req.query('month') || (() => {
      const d = new Date(); d.setMonth(d.getMonth() + 1); return dayKey(d).slice(0, 7)
    })())
    const storeUuid = storeUuidFrom(c)
    const storeId = storeIdForUuid(storeUuid)
    const staff = staffForDevice(deviceUuidFrom(c), storeUuid, storeId)

    let rules = { limit: 3, periodLabel: null as string | null, closesLabel: null as string | null, canEdit: true }
    try {
      const r = db.prepare(`
        SELECT limit_days AS limitDays, period_label AS periodLabel, closes_label AS closesLabel, can_edit AS canEdit
        FROM staff_wish_rules
        WHERE target_month=? AND (store_uuid=? OR store_id=? OR (store_uuid IS NULL AND store_id IS NULL))
        ORDER BY id DESC LIMIT 1
      `).get(month, storeUuid ?? '', storeId ?? -1) as {
        limitDays: number; periodLabel: string | null; closesLabel: string | null; canEdit: number
      } | undefined
      if (r) {
        rules = {
          limit: r.limitDays,
          periodLabel: r.periodLabel,
          closesLabel: r.closesLabel,
          canEdit: r.canEdit === 1,
        }
      } else {
        // no rules configured
        return c.json({
          ok: true,
          month,
          status: 'no_rules',
          canEdit: false,
          editable: false,
          limit: null,
          periodLabel: null,
          closesLabel: null,
          deadline: null,
          selected: [],
          days: [] as string[],
          accepted: [],
          declined: [],
        })
      }
    } catch {
      return c.json({
        ok: true, month, status: 'no_rules', canEdit: false, editable: false,
        limit: null, periodLabel: null, closesLabel: null, deadline: null,
        selected: [], days: [] as string[], accepted: [], declined: [],
      })
    }

    if (!staff) {
      return c.json({
        ok: true, month, status: 'open', canEdit: rules.canEdit, editable: rules.canEdit,
        limit: rules.limit, periodLabel: rules.periodLabel, closesLabel: rules.closesLabel,
        deadline: rules.closesLabel, selected: [], days: [] as string[], accepted: [], declined: [],
      })
    }

    let status = 'open'
    let selected: number[] = []
    let accepted: number[] = []
    let declined: { day: number; reason: string }[] = []
    try {
      const w = db.prepare(`
        SELECT status, selected_json, accepted_json, declined_json
        FROM staff_wishes WHERE staff_id=? AND target_month=?
      `).get(staff.id, month) as {
        status: string; selected_json: string; accepted_json: string; declined_json: string
      } | undefined
      if (w) {
        status = w.status
        selected = parseJsonArr(w.selected_json).map(Number).filter((n) => n > 0)
        accepted = parseJsonArr(w.accepted_json).map(Number).filter((n) => n > 0)
        declined = parseJsonArr(w.declined_json).map((x) => {
          if (typeof x === 'number') return { day: x, reason: '' }
          const o = x as { day?: number; reason?: string }
          return { day: Number(o.day) || 0, reason: String(o.reason || '') }
        }).filter((x) => x.day > 0)
      }
    } catch { /* */ }

    const canEditNow = rules.canEdit && (status === 'open' || status === 'draft')
    // Android 4.9.8: days as strings, editable, deadline
    const daysStr = selected.map((n) => String(n))
    return c.json({
      ok: true,
      month,
      status,
      canEdit: canEditNow,
      editable: canEditNow,
      limit: rules.limit,
      periodLabel: rules.periodLabel,
      closesLabel: rules.closesLabel,
      deadline: rules.closesLabel,
      selected,
      days: daysStr,
      accepted,
      declined,
    })
  })

  .put('/timesheet/wishes',
    evotorProxyStrict,
    zValidator('json', z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      // APK may send string day numbers or yyyy-MM-dd; admin sends int 1–31
      days: z.array(z.union([z.number(), z.string()])).max(31),
    })),
    (c) => {
      const body = c.req.valid('json')
      const month = monthPrefix(body.month)
      const storeUuid = storeUuidFrom(c)
      const storeId = storeIdForUuid(storeUuid)
      const staff = staffForDevice(deviceUuidFrom(c), storeUuid, storeId)
      if (!staff) throw bad('Staff not linked to this device', 400)

      let limit = 3
      let canEdit = true
      try {
        const r = db.prepare(`
          SELECT limit_days AS limitDays, can_edit AS canEdit
          FROM staff_wish_rules WHERE target_month=?
          ORDER BY id DESC LIMIT 1
        `).get(month) as { limitDays: number; canEdit: number } | undefined
        if (!r) throw bad('Wish rules not configured', 400)
        limit = r.limitDays
        canEdit = r.canEdit === 1
      } catch (e) {
        if (e && typeof e === 'object' && 'status' in e) throw e
        throw bad('Wish rules not configured', 400)
      }
      if (!canEdit) throw bad('Period closed', 400)
      const toDayNum = (x: number | string): number => {
        if (typeof x === 'number') return x
        const s = String(x).trim()
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number(s.slice(8, 10))
        return Number(s)
      }
      const days = [...new Set(body.days.map(toDayNum))].filter((d) => d >= 1 && d <= 31).sort((a, b) => a - b)
      if (days.length > limit) throw bad(`Limit is ${limit} days`, 400)

      const now = Date.now()
      const status = days.length ? 'reviewing' : 'open'
      db.prepare(`
        INSERT INTO staff_wishes(staff_id, target_month, status, selected_json, accepted_json, declined_json, updated_at)
        VALUES(?,?,?,?, '[]','[]',?)
        ON CONFLICT(staff_id, target_month) DO UPDATE SET
          status=excluded.status,
          selected_json=excluded.selected_json,
          updated_at=excluded.updated_at
      `).run(staff.id, month, status, JSON.stringify(days), now)

      return c.json({
        ok: true,
        month,
        status,
        canEdit: false,
        editable: false,
        limit,
        periodLabel: null,
        closesLabel: null,
        deadline: null,
        selected: days,
        days: days.map(String),
        accepted: [],
        declined: [],
      })
    })


  // Android 4.9.8 uses POST; same body as PUT
  .post('/timesheet/wishes',
    evotorProxyStrict,
    zValidator('json', z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      days: z.array(z.union([z.number(), z.string()])).max(31),
    })),
    async (c) => {
      // Delegate to same logic as PUT by rewriting — inline duplicate is safer for Hono
      const body = c.req.valid('json')
      const month = monthPrefix(body.month)
      const storeUuid = storeUuidFrom(c)
      const storeId = storeIdForUuid(storeUuid)
      const staff = staffForDevice(deviceUuidFrom(c), storeUuid, storeId)
      if (!staff) throw bad('Staff not linked to this device', 400)
      let limit = 3
      let canEdit = true
      try {
        const r = db.prepare(`
          SELECT limit_days AS limitDays, can_edit AS canEdit
          FROM staff_wish_rules WHERE target_month=?
          ORDER BY id DESC LIMIT 1
        `).get(month) as { limitDays: number; canEdit: number } | undefined
        if (!r) throw bad('Wish rules not configured', 400)
        limit = r.limitDays
        canEdit = r.canEdit === 1
      } catch (e) {
        if (e && typeof e === 'object' && 'status' in e) throw e
        throw bad('Wish rules not configured', 400)
      }
      if (!canEdit) throw bad('Period closed', 400)
      const toDayNum = (x: number | string): number => {
        if (typeof x === 'number') return x
        const s = String(x).trim()
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number(s.slice(8, 10))
        return Number(s)
      }
      const days = [...new Set(body.days.map(toDayNum))].filter((d) => d >= 1 && d <= 31).sort((a, b) => a - b)
      if (days.length > limit) throw bad(`Max ${limit} days`, 400)
      const ts = Date.now()
      db.prepare(`
        INSERT INTO staff_wishes(staff_id, target_month, status, selected_json, accepted_json, declined_json, updated_at)
        VALUES(?, ?, 'open', ?, '[]', '[]', ?)
        ON CONFLICT(staff_id, target_month) DO UPDATE SET
          selected_json=excluded.selected_json, status='open', updated_at=excluded.updated_at
      `).run(staff.id, month, JSON.stringify(days), ts)
      return c.json({
        ok: true, month, status: 'open',
        canEdit: true, editable: true,
        selected: days, days: days.map(String),
        accepted: [], declined: [],
      })
    })

  .get('/shift/breaks', (c) => {
    const storeUuid = storeUuidFrom(c)
    const storeId = storeIdForUuid(storeUuid)
    const staff = staffForDevice(deviceUuidFrom(c), storeUuid, storeId)
    const day = dayKey()
    if (!staff) {
      return c.json({ ok: true, status: 'none', recommendation: null, actual: null })
    }
    try {
      const row = db.prepare(`
        SELECT status, rec_start, rec_end, rec_hint, actual_start, actual_end, actual_minutes
        FROM staff_breaks WHERE staff_id=? AND day=?
      `).get(staff.id, day) as {
        status: string; rec_start: string | null; rec_end: string | null; rec_hint: string | null
        actual_start: string | null; actual_end: string | null; actual_minutes: number | null
      } | undefined
      if (!row) return c.json({ ok: true, status: 'none', recommendation: null, actual: null })
      const recommendation = row.rec_start
        ? {
            start: row.rec_start,
            end: row.rec_end,
            hint: row.rec_hint,
            // Android 4.9.8 aliases
            from: row.rec_start,
            to: row.rec_end,
            reason: row.rec_hint,
          }
        : null
      return c.json({
        ok: true,
        status: row.status,
        recommendation,
        actual: row.actual_start
          ? { start: row.actual_start, end: row.actual_end, minutes: row.actual_minutes }
          : null,
      })
    } catch {
      return c.json({ ok: true, status: 'none', recommendation: null, actual: null })
    }
  })


  /** Android 4.9.8 path; same data as GET /shift/breaks.recommendation */
  .get('/breaks/recommendation', (c) => {
    const storeUuid = storeUuidFrom(c)
    const storeId = storeIdForUuid(storeUuid)
    const staff = staffForDevice(deviceUuidFrom(c), storeUuid, storeId)
    const day = dayKey()
    if (!staff) {
      return c.json({ ok: true, from: null, to: null, reason: null, status: 'none' })
    }
    try {
      const row = db.prepare(`
        SELECT status, rec_start, rec_end, rec_hint
        FROM staff_breaks WHERE staff_id=? AND day=?
      `).get(staff.id, day) as {
        status: string; rec_start: string | null; rec_end: string | null; rec_hint: string | null
      } | undefined
      if (!row?.rec_start) {
        return c.json({ ok: true, from: null, to: null, reason: null, status: row?.status ?? 'none' })
      }
      return c.json({
        ok: true,
        from: row.rec_start,
        to: row.rec_end,
        reason: row.rec_hint,
        status: row.status,
        recommendation: {
          start: row.rec_start, end: row.rec_end, hint: row.rec_hint,
          from: row.rec_start, to: row.rec_end, reason: row.rec_hint,
        },
      })
    } catch {
      return c.json({ ok: true, from: null, to: null, reason: null, status: 'none' })
    }
  })

  .post('/shift/breaks/start', evotorProxyStrict, (c) => {
    const storeUuid = storeUuidFrom(c)
    const storeId = storeIdForUuid(storeUuid)
    const staff = staffForDevice(deviceUuidFrom(c), storeUuid, storeId)
    if (!staff) throw bad('Staff not linked', 400)
    const day = dayKey()
    const now = new Date()
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const ts = Date.now()
    db.prepare(`
      INSERT INTO staff_breaks(staff_id, day, status, actual_start, updated_at)
      VALUES(?,?, 'active', ?, ?)
      ON CONFLICT(staff_id, day) DO UPDATE SET status='active', actual_start=excluded.actual_start, actual_end=NULL, actual_minutes=NULL, updated_at=excluded.updated_at
    `).run(staff.id, day, hm, ts)
    return c.json({
      ok: true,
      status: 'active',
      recommendation: null,
      actual: { start: hm, end: null, minutes: null },
    })
  })

  .post('/shift/breaks/end', evotorProxyStrict, (c) => {
    const storeUuid = storeUuidFrom(c)
    const storeId = storeIdForUuid(storeUuid)
    const staff = staffForDevice(deviceUuidFrom(c), storeUuid, storeId)
    if (!staff) throw bad('Staff not linked', 400)
    const day = dayKey()
    const now = new Date()
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const row = db.prepare(`SELECT actual_start FROM staff_breaks WHERE staff_id=? AND day=?`).get(staff.id, day) as { actual_start: string | null } | undefined
    let minutes: number | null = null
    if (row?.actual_start) {
      const [sh, sm] = row.actual_start.split(':').map(Number)
      minutes = Math.max(0, (now.getHours() * 60 + now.getMinutes()) - (sh * 60 + sm))
    }
    db.prepare(`
      UPDATE staff_breaks SET status='done', actual_end=?, actual_minutes=?, updated_at=?
      WHERE staff_id=? AND day=?
    `).run(hm, minutes, Date.now(), staff.id, day)
    return c.json({
      ok: true,
      status: 'done',
      recommendation: null,
      actual: { start: row?.actual_start ?? null, end: hm, minutes },
    })
  })
