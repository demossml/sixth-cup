/**
 * Push «заказ готов» для PWA.
 *
 * Транзакционные уведомления без внешних сервисов: подписка браузера (PushSubscription) + VAPID-ключи
 * из ENV. Отправляем только два события заказа — «готов» и «оплачен».
 *
 * Правила:
 *  • без VAPID-ключей фича выключена целиком (`503 push_disabled`), ничего не падает;
 *  • подписка привязана к гостю (`user_id`), endpoint уникален — повторная подписка обновляет ключи;
 *  • `404`/`410` от push-сервиса — подписка мертва, помечаем `revoked_at`;
 *  • ошибки не пробрасываем в бизнес-логику заказа: пуш — вспомогательный канал.
 */
// web-push — CJS-пакет без default-экспорта в ESM: берём именованные функции.
import { sendNotification, setVapidDetails } from 'web-push'
import { config } from '../../config'
import { db } from '../../db'
import { log } from '../../lib/logBuffer'

export type PushPayload = { title: string; body: string; url?: string; tag?: string }

export function pushConfigured(): boolean {
  return Boolean(config.vapidPublicKey && config.vapidPrivateKey)
}

let configured = false
function ensureConfigured(): boolean {
  if (!pushConfigured()) return false
  if (!configured) {
    setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey)
    configured = true
  }
  return true
}

export type SubscriptionIn = {
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent?: string | null
}

/** Сохранить/обновить подписку гостя. Повторный вызов с тем же endpoint — идемпотентен. */
export function saveSubscription(userId: number, sub: SubscriptionIn): void {
  const t = Date.now()
  db.prepare(
    `INSERT INTO push_subscriptions(endpoint, p256dh, auth, user_id, user_agent, created_at, updated_at, revoked_at)
     VALUES(?,?,?,?,?,?,?,NULL)
     ON CONFLICT(endpoint) DO UPDATE SET
       p256dh=excluded.p256dh,
       auth=excluded.auth,
       user_id=excluded.user_id,
       user_agent=excluded.user_agent,
       updated_at=excluded.updated_at,
       revoked_at=NULL`,
  ).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, userId, sub.userAgent ?? null, t, t)
}

export function revokeSubscription(userId: number, endpoint: string): void {
  db.prepare('UPDATE push_subscriptions SET revoked_at=? WHERE endpoint=? AND user_id=?').run(Date.now(), endpoint, userId)
}

export function subscriptionsOf(userId: number): Array<{ id: number; endpoint: string; p256dh: string; auth: string }> {
  return db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=? AND revoked_at IS NULL')
    .all(userId) as Array<{ id: number; endpoint: string; p256dh: string; auth: string }>
}

/**
 * Отправить уведомление гостю на все живые подписки.
 * Возвращает число успешных отправок (0 — если фича выключена или подписок нет).
 */
export async function pushToUser(userId: number, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0
  const subs = subscriptionsOf(userId)
  if (!subs.length) return 0
  let sent = 0
  for (const s of subs) {
    try {
      await sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 600 },
      )
      sent += 1
      db.prepare('UPDATE push_subscriptions SET last_sent_at=?, failures=0 WHERE id=?').run(Date.now(), s.id)
    } catch (e) {
      const status = Number((e as { statusCode?: number }).statusCode ?? 0)
      if (status === 404 || status === 410) {
        db.prepare('UPDATE push_subscriptions SET revoked_at=? WHERE id=?').run(Date.now(), s.id)
      } else {
        db.prepare('UPDATE push_subscriptions SET failures=failures+1 WHERE id=?').run(s.id)
        log.warn('push_send_failed', { userId, status })
      }
    }
  }
  return sent
}

/**
 * Метрики доставки push (P2-4): сколько подписок живо, сколько умерло, сколько стабильно падает.
 * Без них сбойные подписки копятся молча: гость «включил уведомления», а пуши не приходят.
 */
export function pushMetrics(): { subscriptions: number; live: number; revoked: number; failing: number; delivered: number } {
  const count = (sql: string) => Number((db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0)
  try {
    return {
      subscriptions: count('SELECT COUNT(*) AS n FROM push_subscriptions'),
      live: count('SELECT COUNT(*) AS n FROM push_subscriptions WHERE revoked_at IS NULL'),
      revoked: count('SELECT COUNT(*) AS n FROM push_subscriptions WHERE revoked_at IS NOT NULL'),
      failing: count('SELECT COUNT(*) AS n FROM push_subscriptions WHERE revoked_at IS NULL AND failures >= 3'),
      delivered: count('SELECT COUNT(*) AS n FROM push_subscriptions WHERE last_sent_at IS NOT NULL'),
    }
  } catch {
    return { subscriptions: 0, live: 0, revoked: 0, failing: 0, delivered: 0 }
  }
}

/** Текст уведомления по статусу заказа. `null` — для этого статуса не пушим. */
export function orderPushPayload(status: string, shortCode: string, orderId: string): PushPayload | null {
  if (status === 'ready') {
    return {
      title: `Заказ ${shortCode} готов`,
      body: 'Забирайте на кассе — покажите QR заказа.',
      url: `/?order=${encodeURIComponent(orderId)}`,
      tag: `order-${orderId}`,
    }
  }
  if (status === 'paid') {
    return {
      title: `Заказ ${shortCode} оплачен`,
      body: 'Можно забирать — назовите номер бариста.',
      url: `/?order=${encodeURIComponent(orderId)}`,
      tag: `order-${orderId}`,
    }
  }
  return null
}

/**
 * Отправить уведомление по статусу ровно один раз на заказ.
 * Вызывается из чтения заказа: авто-«готов» тоже происходит при чтении, отдельного таймера нет.
 */
export function notifyOrderStatus(
  conn: { prepare: (sql: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => { changes: number } } },
  order: { id: string; status: string; shortCode: string; guestUserId?: number | null },
): void {
  if (!pushConfigured()) return
  const userId = order.guestUserId ?? null
  if (!userId) return
  const column = order.status === 'ready' ? 'push_ready_at' : order.status === 'paid' ? 'push_paid_at' : null
  if (!column) return
  const payload = orderPushPayload(order.status, order.shortCode, order.id)
  if (!payload) return
  // Атомарно «застолбить» отправку: второй читатель ничего не отправит.
  const claimed = conn
    .prepare(`UPDATE preorders SET ${column}=? WHERE id=? AND ${column} IS NULL`)
    .run(Date.now(), order.id)
  if (claimed.changes !== 1) return
  void pushToUser(userId, payload).catch(() => { /* канал вспомогательный */ })
}
