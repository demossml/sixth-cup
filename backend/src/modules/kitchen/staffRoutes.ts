/**
 * Экран бариста: список активных заказов, «принят» (seen), «Исполнен» (done), настройки.
 * Все роуты — под staff JWT; бариста ограничен точкой своей учётной записи.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireStaff, type StaffEnv } from '../../middleware/staffAuth'
import { setAlertBlink } from '../staff/appUsers'
import { listActiveKitchenOrders, listRecentKitchenOrders, markKitchenDone, markKitchenSeen } from './service'

/** Окно «последних» заказов у бариста: текущая смена плюс запас. */
const RECENT_WINDOW_MS = 12 * 60 * 60 * 1000

export const kitchenStaffRoutes = new Hono<StaffEnv>()

kitchenStaffRoutes.get('/kitchen/orders', requireStaff(), (c) => {
  const staff = c.get('staff')
  const status = (c.req.query('status') ?? 'active').slice(0, 16)
  if (status === 'active') {
    return c.json({ orders: listActiveKitchenOrders(staff.storeUuid) })
  }
  return c.json({ orders: listRecentKitchenOrders(staff.storeUuid, Date.now() - RECENT_WINDOW_MS) })
})

kitchenStaffRoutes.post('/kitchen/orders/:id/seen', requireStaff(), (c) => {
  const staff = c.get('staff')
  const order = markKitchenSeen(c.req.param('id'), staff.storeUuid)
  return c.json({ ok: true, order })
})

kitchenStaffRoutes.post('/kitchen/orders/:id/done', requireStaff(), (c) => {
  const staff = c.get('staff')
  const { order, changed } = markKitchenDone(c.req.param('id'), staff)
  return c.json({ ok: true, changed, order })
})

/** Настройка «моргание новых заказов» — хранится в учётной записи, а не в браузере. */
kitchenStaffRoutes.patch(
  '/me',
  requireStaff(),
  zValidator('json', z.object({ alertBlink: z.boolean() })),
  (c) => {
    const staff = c.get('staff')
    return c.json({ ok: true, user: setAlertBlink(staff.id, c.req.valid('json').alertBlink) })
  },
)
