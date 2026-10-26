import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'

export const staffAdminRoutes = new Hono()
  .get('/staff', (c) => {
    const rows = db.prepare(`
      SELECT id, store_id AS storeId, store_uuid AS storeUuid, name, role, active, created_at AS createdAt
      FROM staff_members ORDER BY active DESC, id
    `).all()
    return c.json({ staff: rows })
  })

  .post('/staff',
    zValidator('json', z.object({
      id: z.number().int().optional(),
      name: z.string().min(1).max(120),
      role: z.string().min(1).max(80).default('Кассир'),
      storeId: z.number().int().nullable().optional(),
      storeUuid: z.string().max(80).nullable().optional(),
      active: z.boolean().optional(),
    })),
    (c) => {
      const p = c.req.valid('json')
      const now = Date.now()
      if (p.id) {
        const cur = db.prepare(`SELECT id FROM staff_members WHERE id=?`).get(p.id)
        if (!cur) throw bad('Staff not found', 404)
        db.prepare(`
          UPDATE staff_members SET name=?, role=?, store_id=?, store_uuid=?, active=? WHERE id=?
        `).run(p.name, p.role, p.storeId ?? null, p.storeUuid ?? null, p.active === false ? 0 : 1, p.id)
        return c.json({ ok: true, id: p.id })
      }
      db.prepare(`
        INSERT INTO staff_members(store_id, store_uuid, name, role, active, created_at)
        VALUES(?,?,?,?,1,?)
      `).run(p.storeId ?? null, p.storeUuid ?? null, p.name, p.role, now)
      const id = (db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id
      return c.json({ ok: true, id })
    })

  /**
   * PATCH /staff/:id — переименование/смена роли без удаления (R-07).
   * PATCH, а не второй POST: частичное обновление, остальные поля не затираются.
   */
  .patch(
    '/staff/:id',
    zValidator('json', z.object({
      name: z.string().min(1).max(120).optional(),
      role: z.string().min(1).max(80).optional(),
      active: z.boolean().optional(),
    })),
    (c) => {
      const id = Number(c.req.param('id'))
      const cur = db.prepare(`SELECT name, role, active FROM staff_members WHERE id=?`)
        .get(id) as { name: string; role: string; active: number } | undefined
      if (!cur) throw bad('Staff not found', 404)
      const p = c.req.valid('json')
      db.prepare(`UPDATE staff_members SET name=?, role=?, active=? WHERE id=?`).run(
        p.name ?? cur.name,
        p.role ?? cur.role,
        p.active !== undefined ? (p.active ? 1 : 0) : cur.active,
        id,
      )
      return c.json({ ok: true, id })
    },
  )

  .delete('/staff/:id', (c) => {
    const id = Number(c.req.param('id'))
    db.prepare(`UPDATE staff_members SET active=0 WHERE id=?`).run(id)
    return c.json({ ok: true })
  })

  .put('/staff/:id/device',
    zValidator('json', z.object({ deviceUuid: z.string().min(1).max(80) })),
    (c) => {
      const id = Number(c.req.param('id'))
      if (!db.prepare(`SELECT id FROM staff_members WHERE id=?`).get(id)) throw bad('Staff not found', 404)
      const deviceUuid = c.req.valid('json').deviceUuid
      db.prepare(`
        INSERT INTO staff_device_link(device_uuid, staff_id, updated_at) VALUES(?,?,?)
        ON CONFLICT(device_uuid) DO UPDATE SET staff_id=excluded.staff_id, updated_at=excluded.updated_at
      `).run(deviceUuid, id, Date.now())
      return c.json({ ok: true })
    })

  .get('/staff/schedule', (c) => {
    const month = (c.req.query('month') || '').slice(0, 7)
    const staffId = Number(c.req.query('staffId') || 0)
    if (!month || !staffId) throw bad('month and staffId required', 400)
    const rows = db.prepare(`
      SELECT day, status, start_hm AS start, end_hm AS end, label
      FROM staff_schedule_days WHERE staff_id=? AND day LIKE ? ORDER BY day
    `).all(staffId, `${month}-%`)
    return c.json({ days: rows })
  })

  .put('/staff/schedule',
    zValidator('json', z.object({
      staffId: z.number().int(),
      days: z.array(z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        status: z.string().min(1).max(32),
        start: z.string().max(8).nullable().optional(),
        end: z.string().max(8).nullable().optional(),
        label: z.string().max(80).nullable().optional(),
      })),
    })),
    (c) => {
      const p = c.req.valid('json')
      if (!db.prepare(`SELECT id FROM staff_members WHERE id=?`).get(p.staffId)) throw bad('Staff not found', 404)
      const upsert = db.prepare(`
        INSERT INTO staff_schedule_days(staff_id, day, status, start_hm, end_hm, label)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(staff_id, day) DO UPDATE SET
          status=excluded.status, start_hm=excluded.start_hm, end_hm=excluded.end_hm, label=excluded.label
      `)
      db.transaction(() => {
        for (const d of p.days) {
          upsert.run(p.staffId, d.day, d.status, d.start ?? null, d.end ?? null, d.label ?? null)
        }
      })()
      return c.json({ ok: true, count: p.days.length })
    })

  .get('/staff/wish-rules', (c) => {
    const rows = db.prepare(`
      SELECT id, store_id AS storeId, store_uuid AS storeUuid, target_month AS targetMonth,
             period_label AS periodLabel, closes_label AS closesLabel, limit_days AS limitDays, can_edit AS canEdit
      FROM staff_wish_rules ORDER BY target_month DESC
    `).all()
    return c.json({ rules: rows })
  })

  .post('/staff/wish-rules',
    zValidator('json', z.object({
      targetMonth: z.string().regex(/^\d{4}-\d{2}$/),
      periodLabel: z.string().max(80).nullable().optional(),
      closesLabel: z.string().max(80).nullable().optional(),
      limitDays: z.number().int().min(0).max(31).default(3),
      canEdit: z.boolean().default(true),
      storeId: z.number().int().nullable().optional(),
      storeUuid: z.string().max(80).nullable().optional(),
    })),
    (c) => {
      const p = c.req.valid('json')
      db.prepare(`
        INSERT INTO staff_wish_rules(store_id, store_uuid, target_month, period_label, closes_label, limit_days, can_edit)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(store_id, target_month) DO UPDATE SET
          period_label=excluded.period_label, closes_label=excluded.closes_label,
          limit_days=excluded.limit_days, can_edit=excluded.can_edit, store_uuid=excluded.store_uuid
      `).run(
        p.storeId ?? null, p.storeUuid ?? null, p.targetMonth,
        p.periodLabel ?? null, p.closesLabel ?? null, p.limitDays, p.canEdit ? 1 : 0,
      )
      return c.json({ ok: true })
    })

  .get('/staff/wishes', (c) => {
    const month = (c.req.query('month') || '').slice(0, 7)
    const rows = db.prepare(`
      SELECT w.id, w.staff_id AS staffId, s.name AS staffName, w.target_month AS targetMonth,
             w.status, w.selected_json AS selectedJson, w.accepted_json AS acceptedJson,
             w.declined_json AS declinedJson, w.updated_at AS updatedAt
      FROM staff_wishes w
      JOIN staff_members s ON s.id=w.staff_id
      WHERE (?='' OR w.target_month=?)
      ORDER BY w.updated_at DESC LIMIT 200
    `).all(month, month)
    return c.json({ wishes: rows })
  })

  .put('/staff/wishes/:id',
    zValidator('json', z.object({
      status: z.enum(['open', 'draft', 'reviewing', 'accepted', 'partial', 'declined', 'closed']),
      accepted: z.array(z.number().int()).optional(),
      declined: z.array(z.object({ day: z.number().int(), reason: z.string().max(200) })).optional(),
    })),
    (c) => {
      const id = Number(c.req.param('id'))
      const p = c.req.valid('json')
      const cur = db.prepare(`SELECT id FROM staff_wishes WHERE id=?`).get(id)
      if (!cur) throw bad('Wish not found', 404)
      db.prepare(`
        UPDATE staff_wishes SET status=?, accepted_json=?, declined_json=?, updated_at=? WHERE id=?
      `).run(
        p.status,
        JSON.stringify(p.accepted ?? []),
        JSON.stringify(p.declined ?? []),
        Date.now(),
        id,
      )
      return c.json({ ok: true })
    })
