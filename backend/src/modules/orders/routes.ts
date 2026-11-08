import { Hono } from 'hono'
import { db } from '../../db'
import { config } from '../../config'
import { requireAuth, type AuthEnv } from '../../middleware/auth'
import type { DeviceEnv } from '../../middleware/device'
import { deviceStoreAuth } from '../../middleware/deviceStore'
import { evotorProxy } from '../../middleware/evotorProxy'
import {
  activeBan,
  cancelDraft,
  createDraftOrder,
  findIdempotentOrder,
  ensurePreorderTables,
  getOrder,
  getOrderByCode,
  listActive,
  markPaid,
  markPickedUp,
  rejectOrder,
  setOrderEta,
  transitionStatus,
} from './service'
import { allowRequest } from '../../lib/rateLimit'
import { bad } from '../../lib/errors'
import type { CreateOrderBody, ItemIn, PreorderStatus } from './types'
import { BenefitError, benefitAvailable, parseBenefit, quoteOrder, readQuote, releaseReservation, reserveForOrder } from './benefit'

type Env = AuthEnv

type Db = Parameters<typeof createDraftOrder>[0]

/** `db` в проекте — единый экземпляр better-sqlite3, поэтому передаём его напрямую. */
const dbOf = (_c: unknown): Db => db as unknown as Db

/**
 * QR-код заказа подписывается отдельным секретом (ORDER_QR_SECRET) или общим JWT_SECRET.
 * Пустой секрет в проде означает предсказуемые подписи — валидация конфига ловит это при старте.
 */
const secretOf = () => config.orderQrSecret || config.jwtSecret

/**
 * Заказы гостя привязаны к пользователю: без JWT нельзя ни создать заказ, ни прочитать чужой.
 * Это же требование делает возможным бан за невыкуп (нужен стабильный идентификатор гостя).
 */
export const orderGuestRoutes = new Hono<Env>()

orderGuestRoutes.use('*', requireAuth)

const ACTIVE_STATUSES_SQL = `('draft','accepted','cooking','ready')`

/**
 * Активный заказ: ещё не завершён, либо оплачен, но гость не нажал «Я забрал».
 * Кандидатов прогоняем через loadOrder: истёкшие/готовые по таймеру заказы
 * должны потерять статус «активный» до того, как мы ответим гостю.
 */
function findActiveOrderId(userId: number): string | null {
  const rows = db.prepare(
    `SELECT id FROM preorders
      WHERE guest_user_id = ? AND (status IN ${ACTIVE_STATUSES_SQL} OR (status = 'paid' AND picked_up_at IS NULL))
      ORDER BY created_at DESC LIMIT 10`,
  ).all(userId) as { id: string }[]
  for (const r of rows) {
    const order = getOrder(dbOf(null), String(r.id))
    if (!order) continue
    if (['draft', 'accepted', 'cooking', 'ready'].includes(order.status)) return order.id
    if (order.status === 'paid' && !order.pickedUpAt) return order.id
  }
  return null
}

/**
 * Заказ доступен только своему гостю (P1-4).
 * Заказ без `guest_user_id` (создан кассой/админом) гостю недоступен вообще: раньше
 * такой заказ мог открыть любой, кто узнал uuid.
 */
function ownedOrder(id: string, userId: number) {
  const row = db.prepare('SELECT guest_user_id AS uid FROM preorders WHERE id = ?').get(id) as
    | { uid: number | null }
    | undefined
  if (!row?.uid || Number(row.uid) !== userId) return null
  return getOrder(dbOf(null), id)
}

/**
 * Расчёт корзины: сумма позиций, скидка по выбранному бонусу и подписанный quote.
 * PWA только показывает цифры; заказ принимается с этим же quote (иначе `quote_stale`).
 */
orderGuestRoutes.post('/quote', async (c) => {
  ensurePreorderTables(dbOf(c))
  const userId = c.get('userId')
  // Расчёт корзины — самый частый вызов PWA; ограничиваем, чтобы им нельзя было нагрузить БД (P2-9).
  if (!allowRequest(`quote:${userId}`, 120, 60_000)) throw bad('Слишком много запросов. Попробуйте позже.', 429)
  const body = (await c.req.json().catch(() => ({}))) as {
    storeId?: number | string
    items?: ItemIn[]
    benefit?: { kind: 'gift' | 'voucher' | 'cashback'; voucherId?: number | null } | null
  }
  try {
    const q = quoteOrder(dbOf(c), {
      userId,
      storeId: Number(body.storeId),
      items: body.items ?? [],
      benefit: body.benefit ?? null,
    })
    return c.json(q)
  } catch (e) {
    if (e instanceof BenefitError) return c.json({ ok: false, error: e.code, message: e.message }, e.code === 'bad_request' ? 400 : 409)
    throw e
  }
})

orderGuestRoutes.post('/', async (c) => {
  ensurePreorderTables(dbOf(c))
  const userId = c.get('userId')
  const body = (await c.req.json()) as CreateOrderBody
  try {
    // Idempotency-Key проверяем ДО активного заказа: retry того же запроса должен получить свой заказ,
    // а не 409 «у вас уже есть активный заказ».
    const idempotencyKey = c.req.header('idempotency-key') ?? null
    const replay = findIdempotentOrder(dbOf(c), idempotencyKey, userId)
    if (replay) return c.json({ ok: true, order: replay, qrPayload: '' })

    // Один активный заказ: пока текущий не забран и не оплачен — второй создать нельзя.
    const activeId = findActiveOrderId(userId)
    if (activeId) {
      return c.json({
        ok: false,
        error: 'active_order_exists',
        message: 'У вас уже есть активный заказ. Заберите или отмените его.',
        activeOrderId: activeId,
      }, 409)
    }
    const ban = activeBan(dbOf(c), userId)
    if (ban) {
      return c.json({
        ok: false,
        error: 'preorder_banned',
        message: 'Прошлый заказ не был забран и оплачен. Новый заказ пока недоступен.',
        bannedUntil: new Date(ban.until * 1000).toISOString(),
      }, 403)
    }
    const withBenefit = body as CreateOrderBody & { quoteToken?: string | null }
    let benefitJson: string | null = null
    let quoteTotal: number | null = null
    let reservationId: string | null = null
    if (withBenefit.quoteToken) {
      const quote = readQuote(withBenefit.quoteToken)
      if (!quote || quote.uid !== userId) {
        return c.json({ ok: false, error: 'quote_stale', message: 'Расчёт устарел — обновите корзину' }, 409)
      }
      // Сумма позиций должна совпасть с quote: иначе цены/состав поменялись.
      const fresh = quoteOrder(dbOf(c), {
        userId,
        storeId: Number(body.storeId),
        items: body.items ?? [],
        benefit: quote.benefit ? { kind: quote.benefit.kind, voucherId: quote.benefit.voucherId ?? null } : null,
      })
      if (fresh.subtotal !== quote.subtotal) {
        return c.json({ ok: false, error: 'quote_stale', message: 'Состав или цены изменились — обновите корзину' }, 409)
      }
      if (quote.benefit) {
        benefitJson = JSON.stringify(quote.benefit)
        quoteTotal = quote.total
        reservationId = reserveForOrder(dbOf(c), { userId, storeId: Number(body.storeId), benefit: quote.benefit, total: quote.total })
      }
    }
    // Idempotency-Key уже прочитан выше: повторная отправка не создаст второй заказ.
    const { order, qrPayload } = createDraftOrder(dbOf(c), body, { guestUserId: userId, secret: secretOf(), idempotencyKey })
    if (benefitJson || reservationId) {
      db.prepare('UPDATE preorders SET benefit_json=?, reservation_id=?, quote_total=?, quoted_at=? WHERE id=?')
        .run(benefitJson, reservationId, quoteTotal, Math.floor(Date.now() / 1000), order.id)
    }
    const fresh = getOrder(dbOf(c), order.id)!
    return c.json({ ok: true, order: fresh, qrPayload })
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const code = err.code || 'error'
    return c.json({ ok: false, error: code, message: err.message || code }, 400)
  }
})

// ВАЖНО: /active объявлен до /:id, иначе «active» попадёт в параметр.
orderGuestRoutes.get('/active', (c) => {
  ensurePreorderTables(dbOf(c))
  const userId = c.get('userId')
  // Сначала «проявляем» истёкшие заказы (это может создать бан), и только потом читаем бан.
  const id = findActiveOrderId(userId)
  const ban = activeBan(dbOf(c), userId)
  const bannedUntil = ban ? new Date(ban.until * 1000).toISOString() : null
  if (!id) return c.json({ ok: true, order: null, bannedUntil })
  const order = getOrder(dbOf(c), id)
  return c.json({ ok: true, order: order ?? null, bannedUntil })
})

orderGuestRoutes.get('/:id', (c) => {
  ensurePreorderTables(dbOf(c))
  const order = ownedOrder(c.req.param('id'), c.get('userId'))
  if (!order) return c.json({ ok: false, error: 'not_found', message: 'Заказ не найден' }, 404)
  return c.json({ ok: true, order })
})

orderGuestRoutes.post('/:id/cancel', (c) => {
  ensurePreorderTables(dbOf(c))
  try {
    const id = c.req.param('id')
    const row = db.prepare('SELECT reservation_id AS rid FROM preorders WHERE id=?').get(id) as { rid: string | null } | undefined
    cancelDraft(dbOf(c), id, c.get('userId'))
    // Льгота возвращается гостю: резерв больше не будет предъявлен на кассе.
    releaseReservation(dbOf(c), row?.rid)
    return c.json({ ok: true })
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return c.json({ ok: false, error: err.code || 'error', message: err.message || 'error' }, 400)
  }
})

/** «Я забрал»: закрывает активный заказ, не меняя оплату и статус для кассы. */
orderGuestRoutes.post('/:id/received', (c) => {
  ensurePreorderTables(dbOf(c))
  try {
    const order = markPickedUp(dbOf(c), c.req.param('id'), c.get('userId'))
    return c.json({ ok: true, order })
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return c.json({ ok: false, error: err.code || 'error', message: err.message || 'error' }, 409)
  }
})

/**
 * Device routes: mounted under /api/devices.
 * Точка определяется deviceStoreAuth: по X-Device-Token (enroll) либо по X-Evotor-Store-Uuid
 * от облака Эвотора (так работает текущий APK). Заказ чужой точки отклоняется проверкой storeId.
 */
export const orderDeviceRoutes = new Hono<DeviceEnv>()

orderDeviceRoutes.use('/orders/*', evotorProxy, deviceStoreAuth)

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

orderDeviceRoutes.post('/orders/:id/eta', async (c) => {
  ensurePreorderTables(dbOf(c))
  const storeId = c.get('storeId')
  const body = (await c.req.json().catch(() => ({}))) as { etaMinutes?: number }
  const minutes = Number(body.etaMinutes)
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
    return c.json({ ok: false, error: 'bad_request', message: 'etaMinutes должен быть 1…120' }, 400)
  }
  const existing = getOrder(dbOf(c), c.req.param('id'))
  if (!existing) return c.json({ ok: false, error: 'not_found', message: 'Заказ не найден' }, 404)
  if (existing.storeId !== storeId) {
    return c.json({ ok: false, error: 'wrong_store', message: 'Заказ для другой точки' }, 403)
  }
  try {
    const order = setOrderEta(dbOf(c), c.req.param('id'), minutes)
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
  // Необязательный контекст оплаты: если касса его пришлёт, сервер сверит сумму и фискальный номер.
  const pay = (await c.req.json().catch(() => ({}))) as {
    fiscalDocumentNumber?: string | null
    amountRub?: number | string | null
  }
  const existing = getOrder(dbOf(c), c.req.param('id'))
  if (!existing) return c.json({ ok: false, error: 'not_found', message: 'Заказ не найден' }, 404)
  if (existing.storeId !== storeId) {
    return c.json({ ok: false, error: 'wrong_store', message: 'Заказ для другой точки' }, 403)
  }
  try {
    const order = markPaid(dbOf(c), c.req.param('id'), {
      fiscalDocumentNumber: pay.fiscalDocumentNumber ?? null,
      amountRub: pay.amountRub == null ? null : Number(pay.amountRub),
    })
    return c.json({ ok: true, order })
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return c.json({ ok: false, error: err.code || 'error', message: err.message || 'error' }, 409)
  }
})
