/**
 * Очередь бариста: заказы, которые касса создаёт сама после ухода продажи (источник A).
 *
 * Правила модуля:
 *  • идемпотентность по `(store_uuid, client_order_id)` — повтор POST с кассы не создаёт второй заказ;
 *  • номер очереди выдаёт общий модуль `queue/numbers` (тот же счётчик, что печатается на чеке):
 *    если касса уже взяла номер по `queueOrderId`, он переиспользуется, а не тратится второй;
 *  • бариста видит только активные заказы своей точки (new → seen → done);
 *  • push гостю отправляется только один раз, при переходе в done.
 */
import { randomUUID } from 'node:crypto'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { issueQueueNumber } from '../queue/numbers'
import { pushToUser } from '../push/service'
import { log } from '../../lib/logBuffer'

export const KITCHEN_STATUSES = ['new', 'seen', 'in_progress', 'done', 'cancelled'] as const
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number]

/** Активные для бариста: ещё не исполнены и не отменены. */
const ACTIVE_STATUSES: KitchenStatus[] = ['new', 'seen', 'in_progress']

export type KitchenItem = { name: string; qty: number; mods: string[]; note: string | null }

export type KitchenOrder = {
  id: string
  storeUuid: string
  queueNumber: number | null
  queueOrderId: string | null
  clientOrderId: string
  status: KitchenStatus
  source: string
  items: KitchenItem[]
  guestUserId: number | null
  cardCodeMask: string | null
  totalKopecks: number | null
  evotorDocId: string | null
  createdAt: number
  seenAt: number | null
  doneAt: number | null
  doneByUserId: number | null
}

type Row = {
  id: string
  store_uuid: string
  queue_number: number | null
  queue_order_id: string | null
  client_order_id: string
  status: string
  source: string
  items_json: string
  guest_user_id: number | null
  card_code_mask: string | null
  total_kopecks: number | null
  evotor_doc_id: string | null
  created_at: number
  seen_at: number | null
  done_at: number | null
  done_by_user_id: number | null
}

function parseItems(raw: string): KitchenItem[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((x) => x as Partial<KitchenItem>)
      .filter((x) => typeof x?.name === 'string')
      .map((x) => ({
        name: String(x.name),
        qty: Number(x.qty ?? 1),
        mods: Array.isArray(x.mods) ? x.mods.map(String) : [],
        note: x.note == null ? null : String(x.note),
      }))
  } catch {
    return []
  }
}

function toOrder(row: Row): KitchenOrder {
  return {
    id: row.id,
    storeUuid: row.store_uuid,
    queueNumber: row.queue_number == null ? null : Number(row.queue_number),
    queueOrderId: row.queue_order_id,
    clientOrderId: row.client_order_id,
    status: row.status as KitchenStatus,
    source: row.source,
    items: parseItems(row.items_json),
    guestUserId: row.guest_user_id == null ? null : Number(row.guest_user_id),
    cardCodeMask: row.card_code_mask,
    totalKopecks: row.total_kopecks == null ? null : Number(row.total_kopecks),
    evotorDocId: row.evotor_doc_id,
    createdAt: Number(row.created_at),
    seenAt: row.seen_at == null ? null : Number(row.seen_at),
    doneAt: row.done_at == null ? null : Number(row.done_at),
    doneByUserId: row.done_by_user_id == null ? null : Number(row.done_by_user_id),
  }
}

export function getKitchenOrder(id: string): KitchenOrder | null {
  const row = db.prepare('SELECT * FROM kitchen_orders WHERE id=?').get(id) as Row | undefined
  return row ? toOrder(row) : null
}

export function findKitchenOrderByClientId(storeUuid: string, clientOrderId: string): KitchenOrder | null {
  const row = db
    .prepare('SELECT * FROM kitchen_orders WHERE store_uuid=? AND client_order_id=?')
    .get(storeUuid, clientOrderId) as Row | undefined
  return row ? toOrder(row) : null
}

export type CreateKitchenOrderInput = {
  storeUuid: string
  clientOrderId: string
  items: KitchenItem[]
  totalKopecks?: number | null
  guestUserId?: number | null
  cardCodeMask?: string | null
  queueOrderId?: string | null
  source?: string
  now?: number
}

/**
 * Создание заказа с кассы. Повтор с тем же `clientOrderId` возвращает существующий заказ
 * (`created: false`) — это и есть весь контракт идемпотентности для APK.
 */
export const createKitchenOrder = db.transaction(
  (input: CreateKitchenOrderInput): { order: KitchenOrder; created: boolean } => {
    const storeUuid = String(input.storeUuid || '').trim().slice(0, 80)
    if (!storeUuid) throw bad('storeUuid обязателен', 400)
    const clientOrderId = String(input.clientOrderId || '').trim().slice(0, 80)
    if (!clientOrderId) throw bad('clientOrderId обязателен', 400)
    if (!Array.isArray(input.items) || input.items.length === 0) throw bad('Пустой состав заказа', 400)

    const existing = findKitchenOrderByClientId(storeUuid, clientOrderId)
    if (existing) return { order: existing, created: false }

    const now = input.now ?? Date.now()
    const queueOrderId = (input.queueOrderId ?? '').trim().slice(0, 64) || undefined
    // Номер очереди — из общего счётчика: касса могла уже напечатать его на чеке.
    const queue = issueQueueNumber({
      storeUuid,
      orderId: queueOrderId,
      now,
      ttlMs: 12 * 60 * 60 * 1000,
    })
    if (queue.storeUuid !== storeUuid) throw bad('Номер очереди принадлежит другой точке', 409)

    const id = randomUUID()
    db.prepare(`
      INSERT INTO kitchen_orders(
        id, store_uuid, queue_number, queue_order_id, client_order_id, status, source,
        items_json, guest_user_id, card_code_mask, total_kopecks, evotor_doc_id, created_at
      ) VALUES(?,?,?,?,?, 'new', ?, ?,?,?,?, NULL, ?)
    `).run(
      id,
      storeUuid,
      queue.number,
      queue.orderId,
      clientOrderId,
      (input.source ?? 'cashier').slice(0, 32),
      JSON.stringify(input.items),
      input.guestUserId ?? null,
      input.cardCodeMask ?? null,
      input.totalKopecks ?? null,
      now,
    )
    log.info('kitchen order created', { store: storeUuid.slice(0, 8), number: queue.number })
    return { order: getKitchenOrder(id)!, created: true }
  },
)

/** Активные заказы точки — то, что бариста видит в очереди. */
export function listActiveKitchenOrders(storeUuid: string | null): KitchenOrder[] {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',')
  const rows = storeUuid
    ? (db.prepare(
        `SELECT * FROM kitchen_orders WHERE status IN (${placeholders}) AND store_uuid=? ORDER BY created_at ASC`,
      ).all(...ACTIVE_STATUSES, storeUuid) as Row[])
    : (db.prepare(
        `SELECT * FROM kitchen_orders WHERE status IN (${placeholders}) ORDER BY created_at ASC LIMIT 200`,
      ).all(...ACTIVE_STATUSES) as Row[])
  return rows.map(toOrder)
}

/** Недавние заказы (активные + исполненные) — экран кассы и «последние» у бариста. */
export function listRecentKitchenOrders(storeUuid: string | null, sinceMs: number, limit = 100): KitchenOrder[] {
  const rows = storeUuid
    ? (db.prepare(
        'SELECT * FROM kitchen_orders WHERE store_uuid=? AND created_at>=? ORDER BY created_at DESC LIMIT ?',
      ).all(storeUuid, sinceMs, limit) as Row[])
    : (db.prepare(
        'SELECT * FROM kitchen_orders WHERE created_at>=? ORDER BY created_at DESC LIMIT ?',
      ).all(sinceMs, limit) as Row[])
  return rows.map(toOrder)
}

function assertStoreAccess(order: KitchenOrder, staffStoreUuid: string | null): void {
  if (staffStoreUuid && order.storeUuid !== staffStoreUuid) throw bad('Заказ другой точки', 403)
}

/** Тап по карточке: new → seen. Повторный тап и уже исполненный заказ — без ошибки. */
export function markKitchenSeen(id: string, staffStoreUuid: string | null, now = Date.now()): KitchenOrder {
  const order = getKitchenOrder(id)
  if (!order) throw bad('Заказ не найден', 404)
  assertStoreAccess(order, staffStoreUuid)
  if (order.status === 'new') {
    db.prepare(`UPDATE kitchen_orders SET status='seen', seen_at=? WHERE id=? AND status='new'`).run(now, id)
  }
  return getKitchenOrder(id)!
}

/**
 * «Исполнен»: один переход, повторный вызов ничего не меняет.
 * Push гостю отправляется только тем вызовом, который реально перевёл заказ в done.
 */
export function markKitchenDone(
  id: string,
  staff: { id: number; storeUuid: string | null },
  now = Date.now(),
): { order: KitchenOrder; changed: boolean } {
  const order = getKitchenOrder(id)
  if (!order) throw bad('Заказ не найден', 404)
  assertStoreAccess(order, staff.storeUuid)
  const changed = db.prepare(`
    UPDATE kitchen_orders SET status='done', done_at=?, done_by_user_id=?
    WHERE id=? AND status IN ('new','seen','in_progress')
  `).run(now, staff.id, id).changes > 0
  const updated = getKitchenOrder(id)!
  if (changed && updated.guestUserId) {
    // Push — вспомогательный канал: ошибки не ломают очередь.
    const title = updated.queueNumber == null ? 'Заказ готов' : `Заказ №${updated.queueNumber} готов`
    void pushToUser(updated.guestUserId, {
      title,
      body: 'Заберите заказ на кассе.',
      tag: `kitchen-${updated.id}`,
    }).catch(() => { /* нет подписки или сеть — не ошибка заказа */ })
  }
  return { order: updated, changed }
}
