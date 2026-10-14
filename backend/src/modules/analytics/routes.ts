import { Hono } from 'hono'
import { db } from '../../db'

const ALLOWED = new Set([
  'pwa_open', 'qr_visible', 'sync_ok', 'sync_fail', 'menu_open',
  'install_prompt_shown', 'install_accepted',
])

export const analyticsRoutes = new Hono().post('/events', async (c) => {
  let body: { event?: string; ts?: number; sessionId?: string; meta?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false }, 400)
  }
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
