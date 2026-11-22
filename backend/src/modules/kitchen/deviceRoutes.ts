/**
 * Касса → сервер: создание kitchen-заказа и чтение статусов.
 *
 * Auth тот же, что у catalog/loyalty: device token либо прокси-токен Эвотора
 * (`Authorization` + `X-Evotor-Store-Uuid`). Staff JWT сюда не принимается.
 */
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { bad } from '../../lib/errors'
import { deviceStoreAuth, storeIdFromEvotorUuid } from '../../middleware/deviceStore'
import type { DeviceEnv } from '../../middleware/device'
import { createKitchenOrder, listRecentKitchenOrders } from './service'

const itemSchema = z.object({
  name: z.string().min(1).max(200),
  qty: z.number().int().min(1).max(999),
  mods: z.array(z.string().max(80)).max(20).default([]),
  note: z.string().max(200).nullish(),
})

const createSchema = z.object({
  clientOrderId: z.string().min(3).max(80),
  storeUuid: z.string().max(80).optional(),
  items: z.array(itemSchema).min(1).max(100),
  totalKopecks: z.number().int().min(0).max(100_000_000).nullish(),
  guestUserId: z.number().int().positive().nullish(),
  cardCodeMask: z.string().max(40).nullish(),
  queueOrderId: z.string().max(64).nullish(),
})

const createBodyLimit = bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json({ error: 'payload_too_large' }, 413),
})

/** Точка кассы: заголовок Эвотора и тело должны совпадать, иначе это подмена точки. */
function resolveDeviceStore(
  c: { req: { header: (n: string) => string | undefined } },
  bodyStore?: string | null,
): string {
  const headerStore = (c.req.header('X-Evotor-Store-Uuid') ?? '').trim().slice(0, 80) || null
  const body = (bodyStore ?? '').trim().slice(0, 80) || null
  if (headerStore && body && headerStore !== body) throw bad('storeUuid не совпадает с точкой кассы', 400)
  const storeUuid = body ?? headerStore
  if (!storeUuid) throw bad('storeUuid обязателен', 400)
  if (!storeIdFromEvotorUuid(storeUuid)) throw bad('unknown_store', 404)
  return storeUuid
}

export const kitchenDeviceRoutes = new Hono<DeviceEnv>()

kitchenDeviceRoutes.use('/kitchen/*', deviceStoreAuth)

kitchenDeviceRoutes.post(
  '/kitchen/orders',
  createBodyLimit,
  zValidator('json', createSchema),
  (c) => {
    const body = c.req.valid('json')
    const storeUuid = resolveDeviceStore(c, body.storeUuid)
    // Токен конкретной кассы не должен создавать заказы чужой точки.
    if (c.get('deviceId') && storeIdFromEvotorUuid(storeUuid) !== c.get('storeId')) {
      throw bad('Заказ для другой точки', 403)
    }

    const { order } = createKitchenOrder({
      storeUuid,
      clientOrderId: body.clientOrderId,
      items: body.items.map((i) => ({ name: i.name, qty: i.qty, mods: i.mods, note: i.note ?? null })),
      totalKopecks: body.totalKopecks ?? null,
      guestUserId: body.guestUserId ?? null,
      cardCodeMask: body.cardCodeMask ?? null,
      queueOrderId: body.queueOrderId ?? null,
    })
    // Контракт кассы фиксирован: ровно эти четыре поля, 200 и при повторе (идемпотентность).
    return c.json({
      id: order.id,
      queueNumber: order.queueNumber,
      status: order.status,
      createdAt: order.createdAt,
    })
  },
)

/** Статусы недавних заказов: касса показывает «готов» на последнем номере очереди. */
kitchenDeviceRoutes.get('/kitchen/orders', (c) => {
  const storeUuid = resolveDeviceStore(c, c.req.query('storeUuid'))
  const sinceParam = Number(c.req.query('since') ?? 0)
  const windowMs = Number(c.req.query('windowMin') ?? 120) * 60_000
  const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : Date.now() - windowMs
  return c.json({ orders: listRecentKitchenOrders(storeUuid, since) })
})
