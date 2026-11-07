import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import { db } from '../../db'
import { config } from '../../config'
import { requireDevice, type DeviceEnv } from '../../middleware/device'
import {
  cancelDraft,
  createDraftOrder,
  ensurePreorderTables,
  getOrder,
  getOrderByCode,
  listActive,
  markPaid,
  rejectOrder,
  transitionStatus,
} from './service'
import type { CreateOrderBody, PreorderStatus } from './types'

type Env = { Variables: { userId?: number } }

type Db = Parameters<typeof createDraftOrder>[0]

/** `db` в проекте — единый экземпляр better-sqlite3, поэтому передаём его напрямую. */
const dbOf = (_c: unknown): Db => db as unknown as Db

/**
 * QR-код заказа подписывается отдельным секретом (ORDER_QR_SECRET) или общим JWT_SECRET.
 * Пустой секрет в проде означает предсказуемые подписи — валидация конфига ловит это при старте.
 */
const secretOf = () => config.orderQrSecret || config.jwtSecret

/**
 * Гость может быть не авторизован: заказ создаётся и без карты (тогда card_id пустой).
 * Если JWT есть и валиден — привязываем заказ к пользователю, но не блокируем заказ из-за токена.
 */
const optionalAuth = createMiddleware<Env>(async (c, next) => {
  const header = c.req.header('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  if (token) {
    try {
      const payload = await verify(token, config.jwtSecret, 'HS256')
      const userId = Number(payload.sub)
      if (Number.isFinite(userId) && userId > 0) c.set('userId', userId)
    } catch {
      /* протухший токен не должен мешать оформить заказ — гость просто останется анонимным */
    }
  }
  await next()
})

/** Guest routes: /api/orders */
export const orderGuestRoutes = new Hono<Env>()

orderGuestRoutes.use('*', optionalAuth)

orderGuestRoutes.post('/', async (c) => {
  ensurePreorderTables(dbOf(c))
  const body = (await c.req.json()) as CreateOrderBody
  try {
    const guestUserId = c.get('userId') as number | undefined
    const { order, qrPayload } = createDraftOrder(dbOf(c), body, {
      guestUserId: guestUserId ?? null,
      secret: secretOf(),
    })
    return c.json({ ok: true, order, qrPayload })
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const code = err.code || 'error'
    const status = code === 'store_not_found' || code === 'product_unavailable' ? 400 : 400
    return c.json({ ok: false, error: code, message: err.message || code }, status)
  }
})

orderGuestRoutes.get('/:id', async (c) => {
  ensurePreorderTables(dbOf(c))
  const order = getOrder(dbOf(c), c.req.param('id'))
  if (!order) return c.json({ ok: false, error: 'not_found', message: 'Заказ не найден' }, 404)
  return c.json({ ok: true, order })
})

orderGuestRoutes.post('/:id/cancel', async (c) => {
  ensurePreorderTables(dbOf(c))
  try {
    cancelDraft(dbOf(c), c.req.param('id'), (c.get('userId') as number | undefined) ?? null)
    return c.json({ ok: true })
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return c.json({ ok: false, error: err.code || 'error', message: err.message || 'error' }, 400)
  }
})

/**
 * Device routes: mounted under /api/devices.
 * Доступ — только по X-Device-Token (requireDevice), точка берётся из самого устройства,
 * поэтому заказ чужой точки отклонится проверкой storeId.
 */
export const orderDeviceRoutes = new Hono<DeviceEnv>()

orderDeviceRoutes.use('/orders/*', requireDevice)

orderDeviceRoutes.get('/orders/resolve', async (c) => {
  ensurePreorderTables(dbOf(c))
  const storeId = c.get('storeId')
  const oid = c.req.query('oid')
  const code = c.req.query('code')
  let order = null
  if (oid) order = getOrder(dbOf(c), oid)
  else if (code) order = getOrderByCode(dbOf(c), storeId, code)
  else return c.json({ ok: false, error: 'bad_request', message: 'oid или code обязателен' }, 400)

  if (!order) return c.json({ ok: false, error: 'not_found', message: 'Заказ не найден' }, 404)
  if (order.storeId !== storeId) {
    return c.json({ ok: false, error: 'wrong_store', message: 'Заказ для другой точки' }, 403)
  }
  if (order.status === 'expired') {
    return c.json({ ok: false, error: 'expired', message: 'Срок заказа истёк' }, 410)
  }
  if (order.status === 'paid') {
    return c.json({ ok: false, error: 'already_paid', message: 'Заказ уже оплачен' }, 409)
  }
  if (order.status === 'rejected' || order.status === 'cancelled') {
    return c.json({ ok: false, error: 'rejected', message: 'Заказ отклонён или отменён' }, 409)
  }
  return c.json({ ok: true, order })
})

orderDeviceRoutes.get('/orders/active', async (c) => {
  ensurePreorderTables(dbOf(c))
  const orders = listActive(dbOf(c), c.get('storeId'))
  return c.json({ ok: true, orders })
})

orderDeviceRoutes.patch('/orders/:id/status', async (c) => {
  ensurePreorderTables(dbOf(c))
  const storeId = c.get('storeId')
  const body = (await c.req.json()) as { status?: PreorderStatus }
  const next = body.status
  if (!next || !['accepted', 'cooking', 'ready'].includes(next)) {
    return c.json({ ok: false, error: 'bad_request', message: 'Некорректный статус' }, 400)
  }
  const existing = getOrder(dbOf(c), c.req.param('id'))
  if (!existing) return c.json({ ok: false, error: 'not_found', message: 'Заказ не найден' }, 404)
  if (existing.storeId !== storeId) {
    return c.json({ ok: false, error: 'wrong_store', message: 'Заказ для другой точки' }, 403)
  }
  try {
    const order = transitionStatus(dbOf(c), c.req.param('id'), next)
    return c.json({ ok: true, order })
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return c.json({ ok: false, error: err.code || 'error', message: err.message || 'error' }, 409)
  }
})

orderDeviceRoutes.post('/orders/:id/reject', async (c) => {
  ensurePreorderTables(dbOf(c))
  const storeId = c.get('storeId')
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
  const existing = getOrder(dbOf(c), c.req.param('id'))
  if (!existing) return c.json({ ok: false, error: 'not_found', message: 'Заказ не найден' }, 404)
  if (existing.storeId !== storeId) {
    return c.json({ ok: false, error: 'wrong_store', message: 'Заказ для другой точки' }, 403)
  }
  try {
    rejectOrder(dbOf(c), c.req.param('id'), body.reason || 'Отклонён кассой')
    return c.json({ ok: true })
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return c.json({ ok: false, error: err.code || 'error', message: err.message || 'error' }, 409)
  }
})

orderDeviceRoutes.post('/orders/:id/mark-paid', async (c) => {
  ensurePreorderTables(dbOf(c))
  const storeId = c.get('storeId')
  const existing = getOrder(dbOf(c), c.req.param('id'))
  if (!existing) return c.json({ ok: false, error: 'not_found', message: 'Заказ не найден' }, 404)
  if (existing.storeId !== storeId) {
    return c.json({ ok: false, error: 'wrong_store', message: 'Заказ для другой точки' }, 403)
  }
  try {
    const order = markPaid(dbOf(c), c.req.param('id'))
    return c.json({ ok: true, order })
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return c.json({ ok: false, error: err.code || 'error', message: err.message || 'error' }, 409)
  }
})
