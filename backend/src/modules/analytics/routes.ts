import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'

const ALLOWED = new Set([
  'pwa_open', 'qr_visible', 'sync_ok', 'sync_fail', 'menu_open',
  'install_prompt_shown', 'install_accepted',
])

/** H-03: публичная аналитика — жёсткие границы формы и размера тела. */
const eventSchema = z.object({
  event: z.string().min(1).max(64),
  ts: z.number().finite().optional(),
  sessionId: z.string().max(64).optional(),
  meta: z.record(z.unknown()).optional(),
}).passthrough()

const limit = bodyLimit({
  maxSize: 8 * 1024,
  onError: (c) => c.json({ ok: false, error: 'payload_too_large' }, 413),
})

export const analyticsRoutes = new Hono().post('/events', limit, zValidator('json', eventSchema), (c) => {
  const body = c.req.valid('json') as { event?: string; ts?: number; sessionId?: string; meta?: unknown }
  const event = String(body.event || '')
  if (!ALLOWED.has(event)) return c.json({ ok: false, error: 'unknown event' }, 400)
  const sessionId = String(body.sessionId || '').slice(0, 64)
  const metaJson = JSON.stringify(body.meta && typeof body.meta === 'object' ? body.meta : {}).slice(0, 2000)
  const created = typeof body.ts === 'number' && body.ts > 0 ? body.ts : Date.now()
  try {
    db.prepare(
      `INSERT INTO client_analytics_events(event, session_id, meta_json, created_at) VALUES (?,?,?,?)`,
    ).run(event, sessionId, metaJson, created)
  } catch (e) {
    console.warn('[analytics] insert failed', e)
    return c.json({ ok: false }, 500)
  }
  return c.json({ ok: true })
})
