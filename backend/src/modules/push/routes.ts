import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, type AuthEnv } from '../../middleware/auth'
import { config } from '../../config'
import { allowRequest } from '../../lib/rateLimit'
import { pushConfigured, revokeSubscription, saveSubscription } from './service'

/** Подписка PWA на push «заказ готов». Только для авторизованного гостя. */
export const pushRoutes = new Hono<AuthEnv>()

/** Публичный ключ для `pushManager.subscribe` (не секрет, нужен до подписки). */
pushRoutes.get('/public-key', (c) => {
  if (!pushConfigured()) {
    return c.json({ ok: false, error: 'push_disabled', message: 'Уведомления не настроены на сервере' }, 503)
  }
  return c.json({ ok: true, publicKey: config.vapidPublicKey })
})

// Всё остальное — только для авторизованного гостя.
pushRoutes.use('*', requireAuth)

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(500),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
  userAgent: z.string().max(300).optional().nullable(),
})

pushRoutes.post('/subscribe', async (c) => {
  if (!pushConfigured()) return c.json({ ok: false, error: 'push_disabled' }, 503)
  // Подписка не должна превращаться в канал спама подписок на один аккаунт (P2-9).
  if (!allowRequest(`push-sub:${c.get('userId')}`, 20, 60 * 60_000)) {
    return c.json({ ok: false, error: 'rate_limited' }, 429)
  }
  const body = await c.req.json().catch(() => null)
  const parsed = subscriptionSchema.safeParse(body)
  if (!parsed.success) return c.json({ ok: false, error: 'bad_request', message: 'Некорректная подписка' }, 400)
  saveSubscription(c.get('userId'), parsed.data)
  return c.json({ ok: true })
})

pushRoutes.delete('/subscribe', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { endpoint?: string }
  if (!body.endpoint) return c.json({ ok: false, error: 'bad_request' }, 400)
  revokeSubscription(c.get('userId'), String(body.endpoint))
  return c.json({ ok: true })
})
