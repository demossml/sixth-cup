import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { getPreorderSettings } from '../../lib/preorderSettings'
import { parseBenefit } from './benefit'
import { notifyOrderStatus } from '../push/service'
import type { CreateOrderBody, ItemOut, ModifierOut, OrderOut, PreorderStatus } from './types'
import { resolveItemModifiers } from './pricing'
import { ACTIVE_STATUSES, ALLOWED_TRANSITIONS } from './types'

type Db = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => Record<string, unknown> | undefined
    all: (...args: unknown[]) => Record<string, unknown>[]
    run: (...args: unknown[]) => { changes: number }
  }
  exec: (sql: string) => void
}

function nowSec() {
  return Math.floor(Date.now() / 1000)
}

function iso(sec: number) {
  return new Date(sec * 1000).toISOString()
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url')
}

export function buildQrPayload(orderId: string, storeId: number, exp: number, secret: string): string {
  const nonce = randomBytes(8).toString('hex')
  const payload = JSON.stringify({ v: 1, t: 'ord', oid: orderId, store: String(storeId), exp, nonce })
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url')
  const sig = signPayload(payloadB64, secret)
  return `ord1.${payloadB64}.${sig}`
}

function genShortCode(db: Db, storeId: number): string {
  for (let i = 0; i < 30; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const row = db
      .prepare(
        `SELECT id FROM preorders WHERE store_id = ? AND short_code = ? AND status IN ('draft','accepted','cooking','ready') LIMIT 1`,
      )
      .get(storeId, code)
    if (!row) return code
  }
  throw new Error('short_code_exhausted')
}

function loadOrder(db: Db, id: string): OrderOut | null {
  const o = db.prepare(`SELECT * FROM preorders WHERE id = ?`).get(id)
  if (!o) return null
  expireIfNeeded(db, o)
  promoteIfDue(db, o)
  const fresh = db.prepare(`SELECT * FROM preorders WHERE id = ?`).get(id)!
  const items = db
    .prepare(`SELECT * FROM preorder_items WHERE order_id = ? ORDER BY position ASC`)
    .all(id)
  const outItems: ItemOut[] = items.map((it) => {
    const mods = db
      .prepare(`SELECT * FROM preorder_item_modifiers WHERE order_item_id = ?`)
      .all(String(it.id))
    const modifiers: ModifierOut[] = mods.map((m) => {
      const evotorUuid = m.evotor_uuid ? String(m.evotor_uuid) : null
      const paid = Number(m.price_estimate) > 0
      return {
        group: String(m.group_key),
        id: String(m.modifier_id),
        name: String(m.name),
        priceEstimate: Number(m.price_estimate) || 0,
        sendToReceipt: Number(m.send_to_receipt) === 1,
        evotorUuid,
        // Касса добавит эту добавку вручную: связи товара с точкой нет (B-02, не выдумываем uuid).
        warning: evotorUuid == null && paid ? ('no_evotor_uuid' as const) : null,
      }
    })
    return {
      lineId: String(it.id),
      productId: String(it.product_id),
      evotorProductUuid: it.evotor_product_uuid ? String(it.evotor_product_uuid) : null,
      name: String(it.name),
      quantity: Number(it.quantity),
      volumeLabel: it.volume_label ? String(it.volume_label) : null,
      configText: String(it.config_text || ''),
      unitPriceEstimate: Number(it.unit_price_estimate),
      modifiers,
    }
  })
  const etaReadyAt = fresh.eta_ready_at ? Number(fresh.eta_ready_at) : null
  const now = nowSec()
  const out: OrderOut = {
    id: String(fresh.id),
    shortCode: String(fresh.short_code),
    storeId: Number(fresh.store_id),
    status: String(fresh.status) as PreorderStatus,
    createdAt: iso(Number(fresh.created_at)),
    expiresAt: iso(Number(fresh.expires_at)),
    etaReadyAt: etaReadyAt ? iso(etaReadyAt) : null,
    // Остаток важен только пока заказ не готов: после «ready»/«paid» время не показываем.
    etaMinutes: etaReadyAt && ['accepted', 'cooking'].includes(String(fresh.status))
      ? Math.max(0, Math.ceil((etaReadyAt - now) / 60))
      : null,
    serverNow: iso(now),
    pickedUpAt: fresh.picked_up_at ? iso(Number(fresh.picked_up_at)) : null,
    readyBy: fresh.ready_by === 'auto' || fresh.ready_by === 'cashier' ? fresh.ready_by : null,
    estimateTotal: Number(fresh.estimate_total),
    quoteTotal: fresh.quote_total != null ? Number(fresh.quote_total) : null,
    benefit: parseBenefit(fresh.benefit_json),
    currency: String(fresh.currency || 'RUB'),
    cardId: fresh.card_id ? String(fresh.card_id) : null,
    items: outItems,
    // Предупреждения для кассы/админки: что не удалось связать с точкой.
    warnings: outItems.flatMap((it) =>
      it.modifiers.filter((m) => m.warning).map((m) => `${m.warning}:${it.name}:${m.name}`),
    ),
  }
  // Push «заказ готов / оплачен» — ровно один раз на заказ (отметки в preorders).
  notifyOrderStatus(db as never, {
    id: String(fresh.id),
    status: String(fresh.status),
    shortCode: String(fresh.short_code),
    guestUserId: fresh.guest_user_id != null ? Number(fresh.guest_user_id) : null,
  })
  return out
}

function expireIfNeeded(db: Db, row: Record<string, unknown>) {
  const status = String(row.status)
  if (!ACTIVE_STATUSES.includes(status as PreorderStatus)) return
  if (Number(row.expires_at) >= nowSec()) return
  db.prepare(`UPDATE preorders SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('draft','accepted','cooking','ready')`).run(
    nowSec(),
    String(row.id),
  )
  // Бан — только за реальный невыкуп: заказ был принят кассой (accepted/cooking/ready),
  // не оплачен и не забран. Если касса даже не приняла draft, гость не виноват.
  const tookByCashier = status === 'accepted' || status === 'cooking' || status === 'ready'
  if (tookByCashier && !row.paid_at && row.guest_user_id) {
    applyNoShowBan(db, Number(row.guest_user_id), Number(row.store_id), String(row.id))
  }
}

/**
 * Авто-переходы по таймеру: «принят» → «готовится» через минуту,
 * «готовится» → «готов» по eta_ready_at (если включено autoReady).
 * Кассир всегда может подтвердить «готов» раньше — тогда ready_by = 'cashier'.
 */
function promoteIfDue(db: Db, row: Record<string, unknown>) {
  const status = String(row.status)
  if (status !== 'accepted' && status !== 'cooking') return
  const id = String(row.id)
  const now = nowSec()
  const settings = getPreorderSettings(Number(row.store_id))
  if (status === 'accepted') {
    const acceptedAt = row.accepted_at ? Number(row.accepted_at) : Number(row.updated_at)
    if (now - acceptedAt < 60) return
    db.prepare(`UPDATE preorders SET status = 'cooking', cooking_at = ?, updated_at = ? WHERE id = ? AND status = 'accepted'`)
      .run(now, now, id)
    return
  }
  if (!settings.autoReady) return
  const eta = row.eta_ready_at ? Number(row.eta_ready_at) : null
  if (!eta || now < eta) return
  db.prepare(`UPDATE preorders SET status = 'ready', ready_at = ?, ready_by = 'auto', updated_at = ? WHERE id = ? AND status = 'cooking'`)
    .run(now, now, id)
}

/** Сколько минут реально нужно на заказ: база точки, но не меньше суммы рецептов. */
export function prepMinutesForOrder(db: Db, orderId: string, storeId: number, itemsOverride?: { seconds: number; qty: number }[]): number {
  const settings = getPreorderSettings(storeId)
  let seconds = 0
  if (itemsOverride) {
    seconds = itemsOverride.reduce((sum, it) => sum + Math.max(0, it.seconds) * Math.max(1, it.qty), 0)
  } else {
    try {
      const row = db.prepare(
        `SELECT COALESCE(SUM(COALESCE(p.recipe_seconds,0) * i.quantity),0) AS s
           FROM preorder_items i LEFT JOIN products p ON p.id = CAST(i.product_id AS INTEGER)
          WHERE i.order_id = ?`,
      ).get(orderId) as { s: number } | undefined
      seconds = Number(row?.s ?? 0)
    } catch {
      seconds = 0
    }
  }
  const fromRecipe = seconds > 0 ? Math.ceil(seconds / 60) : 0
  return Math.min(120, Math.max(1, Math.max(settings.prepMinutes, fromRecipe)))
}

function applyNoShowBan(db: Db, userId: number, storeId: number, orderId: string) {
  const hours = getPreorderSettings(storeId).noShowBanHours
  if (hours <= 0) return
  const until = nowSec() + hours * 3600
  db.prepare(
    `INSERT INTO preorder_bans(user_id, until, reason, order_id, created_at, lifted_at)
     VALUES(?,?, 'no_show', ?, ?, NULL)
     ON CONFLICT(user_id) DO UPDATE SET until = excluded.until, reason = excluded.reason,
       order_id = excluded.order_id, created_at = excluded.created_at, lifted_at = NULL`,
  ).run(userId, until, orderId, nowSec())
}

/** Активный бан гостя (null — можно заказывать). Истёкшие баны снимаются на чтении. */
export function activeBan(db: Db, userId: number): { until: number; reason: string; orderId: string | null } | null {
  const row = db.prepare('SELECT until, reason, order_id, lifted_at FROM preorder_bans WHERE user_id = ?')
    .get(userId) as { until: number; reason: string; order_id: string | null; lifted_at: number | null } | undefined
  if (!row) return null
  if (row.lifted_at) return null
  const now = nowSec()
  if (Number(row.until) <= now) {
    db.prepare('UPDATE preorder_bans SET lifted_at = ? WHERE user_id = ? AND lifted_at IS NULL').run(now, userId)
    return null
  }
  return { until: Number(row.until), reason: String(row.reason), orderId: row.order_id ? String(row.order_id) : null }
}

export function liftBan(db: Db, userId: number): boolean {
  const r = db.prepare('UPDATE preorder_bans SET lifted_at = ? WHERE user_id = ? AND lifted_at IS NULL').run(nowSec(), userId)
  return r.changes > 0
}

export function listBans(db: Db): { userId: number; until: number; reason: string; orderId: string | null; createdAt: number }[] {
  const now = nowSec()
  return (db.prepare(
    `SELECT user_id AS userId, until, reason, order_id AS orderId, created_at AS createdAt
       FROM preorder_bans WHERE lifted_at IS NULL AND until > ? ORDER BY until DESC LIMIT 200`,
  ).all(now) as { userId: number; until: number; reason: string; orderId: string | null; createdAt: number }[])
}

/**
 * UUID товара на конкретной точке. В проекте два пространства:
 * локальный `stores.id` (заказы, касса) и Evotor `store_uuid` (`product_store_links`).
 * Связь — через `evotor_stores.local_store_id`.
 */
export function storeUuidsForLocalStore(db: Db, storeId: number): string[] {
  try {
    return (db.prepare('SELECT store_uuid AS uuid FROM evotor_stores WHERE local_store_id = ?')
      .all(storeId) as { uuid: string }[]).map((r) => String(r.uuid)).filter(Boolean)
  } catch {
    return []
  }
}

function evotorUuidForProduct(db: Db, productId: number | null, storeUuids: string[]): string | null {
  if (productId == null || !Number.isFinite(productId) || storeUuids.length === 0) return null
  try {
    const placeholders = storeUuids.map(() => '?').join(',')
    const row = db.prepare(
      `SELECT evotor_uuid AS uuid FROM product_store_links
        WHERE product_id = ? AND enabled = 1 AND evotor_uuid IS NOT NULL AND evotor_uuid <> ''
          AND store_uuid IN (${placeholders})
        LIMIT 1`,
    ).get(productId, ...storeUuids) as { uuid: string } | undefined
    return row?.uuid ? String(row.uuid) : null
  } catch {
    return null
  }
}

/**
 * Строка заказа: цена-оценка, подпись состава и UUID для кассы.
 * Объём (`volumeId`) — это отдельный SKU-товар, поэтому цена и UUID берутся у него, а не у карточки.
 */
function resolveLine(
  db: Db,
  item: CreateOrderBody['items'][0],
  storeUuids: string[],
): { name: string; unit: number; evotor: string | null; volumeLabel: string | null; configText: string; mods: ModifierOut[]; warnings: string[] } {
  const skuId = item.volumeId ?? item.productId
  const productId = String(skuId)
  // `SELECT *`: набор колонок products зависит от миграций, а нам нужны только id/name/price/available/variant_label.
  const p =
    db.prepare(`SELECT * FROM products WHERE id = ? OR cast(id as text) = ?`).get(
      Number(productId) || -1,
      productId,
    ) || db.prepare(`SELECT * FROM products WHERE name = ?`).get(productId)

  if (!p || Number(p.available) === 0) {
    throw Object.assign(new Error('product_unavailable'), { code: 'product_unavailable', productId })
  }

  const skuProductId = Number(p.id)
  // Цена и состав — серверные: клиент присылает только выбор опций (цена 0 в запросе ничего не занижает).
  // Один резолвер с quote: иначе корзина и заказ расходятся по сумме (B-07).
  const resolved = resolveItemModifiers(db as never, skuProductId, Number(p.price) || 0, item.modifiers ?? [])
  const mods: ModifierOut[] = resolved.modifiers.map((m) => {
    const uuid = m.zeroOption || m.priceRub <= 0 ? null : evotorUuidForProduct(db, m.productId, storeUuids)
    return {
      group: m.groupKey,
      id: m.optionId,
      name: m.name,
      priceEstimate: m.priceRub,
      sendToReceipt: !(m.groupKey === 'milk' && m.priceRub === 0),
      evotorUuid: uuid,
      // Причина, по которой касса не сможет добавить добавку автоматически.
      warning: uuid == null && !m.zeroOption && m.priceRub > 0 ? 'no_evotor_uuid' : null,
    }
  })

  const volumeLabel: string | null = p.variant_label ? String(p.variant_label) : null
  const configParts = mods.map((m) => m.name)
  if (volumeLabel) configParts.unshift(volumeLabel)

  return {
    name: String(p.name),
    unit: resolved.unitPrice,
    evotor: evotorUuidForProduct(db, skuProductId, storeUuids),
    volumeLabel,
    configText: configParts.join(' · '),
    mods,
    warnings: resolved.warnings,
  }
}

/** Idempotency-Key: повтор того же запроса возвращает тот же заказ, а не создаёт второй (P1-3). */
function idempotentOrder(db: Db, key: string | null | undefined, userId: number | null): { order: OrderOut; qrPayload: string } | null {
  const k = String(key ?? '').trim().slice(0, 120)
  if (!k) return null
  try {
    const row = db.prepare('SELECT user_id AS userId, result_id AS resultId, created_at AS createdAt FROM idempotency_keys WHERE key=? AND scope=?')
      .get(k, 'create_order') as { userId: number | null; resultId: string | null; createdAt: number } | undefined
    if (!row) return null
    // Ключ принадлежит другому гостю — не отдаём чужой заказ.
    if (row.userId != null && userId != null && Number(row.userId) !== userId) return null
    if (!row.resultId) return null
    const order = getOrder(db, String(row.resultId))
    if (!order) return null
    return { order, qrPayload: '' }
  } catch {
    return null
  }
}

/** Публичная проверка ключа: повтор запроса возвращает существующий заказ (P1-3). */
export function findIdempotentOrder(db: Db, key: string | null | undefined, userId: number | null): OrderOut | null {
  return idempotentOrder(db, key, userId)?.order ?? null
}

function rememberIdempotency(db: Db, key: string | null | undefined, userId: number | null, orderId: string): void {
  const k = String(key ?? '').trim().slice(0, 120)
  if (!k) return
  try {
    db.prepare('INSERT OR REPLACE INTO idempotency_keys(key, scope, user_id, result_id, created_at) VALUES(?,?,?,?,?)')
      .run(k, 'create_order', userId ?? null, orderId, nowSec())
  } catch {
    /* таблицы может не быть в старых базах — идемпотентность не критична для создания */
  }
}

export function createDraftOrder(
  db: Db,
  body: CreateOrderBody,
  opts: { guestUserId?: number | null; secret: string; idempotencyKey?: string | null },
): { order: OrderOut; qrPayload: string } {
  const storeId = Number(body.storeId)
  if (!Number.isFinite(storeId)) throw Object.assign(new Error('invalid_store'), { code: 'invalid_store' })
  const store = db.prepare(`SELECT id FROM stores WHERE id = ?`).get(storeId)
  if (!store) throw Object.assign(new Error('store_not_found'), { code: 'store_not_found' })
  if (!body.items?.length) throw Object.assign(new Error('empty_items'), { code: 'empty_items' })

  // Повтор с тем же Idempotency-Key — отдаём уже созданный заказ.
  const replay = idempotentOrder(db, opts.idempotencyKey, opts.guestUserId ?? null)
  if (replay) return { order: replay.order, qrPayload: buildQrPayload(replay.order.id, storeId, Math.floor(Date.parse(replay.order.expiresAt) / 1000), opts.secret) }

  const id = randomUUID()
  const shortCode = genShortCode(db, storeId)
  const created = nowSec()
  const expires = created + 30 * 60
  const storeUuids = storeUuidsForLocalStore(db, storeId)
  let total = 0
  const orderWarnings: string[] = []
  const resolved = body.items.map((it, idx) => {
    const r = resolveLine(db, it, storeUuids)
    orderWarnings.push(...r.warnings)
    const quantity = Math.max(1, Math.min(99, Number(it.quantity) || 1))
    total += r.unit * quantity
    return { ...r, quantity, productId: String(it.volumeId ?? it.productId), position: idx }
  })

  try {
    db.prepare(
      `INSERT INTO preorders (id, short_code, store_id, status, card_id, guest_user_id, estimate_total, currency, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, 'RUB', ?, ?, ?)`,
    ).run(id, shortCode, storeId, body.cardId || null, opts.guestUserId ?? null, total, expires, created, created)
  } catch (e) {
    // Уникальный индекс «один активный заказ на гостя»: гонка двух параллельных запросов.
    if (String((e as { code?: string }).code ?? '').includes('SQLITE_CONSTRAINT')) {
      throw Object.assign(new Error('active_order_exists'), { code: 'active_order_exists' })
    }
    throw e
  }

  for (const r of resolved) {
    const lineId = randomUUID()
    db.prepare(
      `INSERT INTO preorder_items (id, order_id, product_id, evotor_product_uuid, name, quantity, volume_label, config_text, unit_price_estimate, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(lineId, id, r.productId, r.evotor, r.name, r.quantity, r.volumeLabel, r.configText, r.unit, r.position)
    for (const m of r.mods) {
      db.prepare(
        `INSERT INTO preorder_item_modifiers (id, order_item_id, group_key, modifier_id, name, price_estimate, send_to_receipt, evotor_uuid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), lineId, m.group, m.id, m.name, m.priceEstimate, m.sendToReceipt ? 1 : 0, m.evotorUuid)
    }
  }

  rememberIdempotency(db, opts.idempotencyKey, opts.guestUserId ?? null, id)
  const order = loadOrder(db, id)!
  const qrPayload = buildQrPayload(id, storeId, expires, opts.secret)
  return { order, qrPayload }
}

export function getOrder(db: Db, id: string): OrderOut | null {
  return loadOrder(db, id)
}

export function getOrderByCode(db: Db, storeId: number, code: string): OrderOut | null {
  const row = db
    .prepare(
      `SELECT id FROM preorders WHERE store_id = ? AND short_code = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(storeId, code)
  if (!row) return null
  return loadOrder(db, String(row.id))
}

export function listActive(db: Db, storeId: number): Array<{
  id: string
  shortCode: string
  status: string
  createdAt: string
  estimateTotal: number
  itemsCount: number
}> {
  const rows = db
    .prepare(
      `SELECT id, short_code, status, created_at, estimate_total, expires_at FROM preorders
       WHERE store_id = ? AND status IN ('draft','accepted','cooking','ready')
       ORDER BY created_at DESC LIMIT 100`,
    )
    .all(storeId)
  const out = []
  for (const r of rows) {
    expireIfNeeded(db, r)
    promoteIfDue(db, r)
    const fresh = db.prepare(`SELECT status FROM preorders WHERE id = ?`).get(String(r.id))
    if (!fresh || !ACTIVE_STATUSES.includes(String(fresh.status) as PreorderStatus)) continue
    const cnt = db.prepare(`SELECT COUNT(*) as c FROM preorder_items WHERE order_id = ?`).get(String(r.id))
    out.push({
      id: String(r.id),
      shortCode: String(r.short_code),
      status: String(fresh.status),
      createdAt: iso(Number(r.created_at)),
      estimateTotal: Number(r.estimate_total),
      itemsCount: Number(cnt?.c || 0),
    })
  }
  return out
}

export function transitionStatus(db: Db, id: string, next: PreorderStatus): OrderOut {
  const row = db.prepare(`SELECT * FROM preorders WHERE id = ?`).get(id)
  if (!row) throw Object.assign(new Error('not_found'), { code: 'not_found' })
  expireIfNeeded(db, row)
  promoteIfDue(db, row)
  const cur = String(db.prepare(`SELECT status FROM preorders WHERE id = ?`).get(id)?.status)
  const allowed = ALLOWED_TRANSITIONS[cur] || []
  if (!allowed.includes(next)) {
    throw Object.assign(new Error('invalid_transition'), { code: 'invalid_transition', from: cur, to: next })
  }
  const t = nowSec()
  const storeId = Number(row.store_id)
  if (next === 'accepted') {
    const prepMinutes = prepMinutesForOrder(db, id, storeId)
    const eta = t + prepMinutes * 60
    // Гость получает запас на «дойти и забрать»: TTL не обрывает уже принятый заказ слишком рано.
    const grace = getPreorderSettings(storeId).pickupGraceMinutes
    const expires = Math.max(Number(row.expires_at) || 0, eta + grace * 60)
    db.prepare(
      `UPDATE preorders SET status='accepted', accepted_at=?, eta_ready_at=?, expires_at=?, updated_at=? WHERE id=?`,
    ).run(t, eta, expires, t, id)
  } else if (next === 'cooking') {
    db.prepare(`UPDATE preorders SET status='cooking', cooking_at=?, updated_at=? WHERE id=?`).run(t, t, id)
  } else if (next === 'ready') {
    db.prepare(`UPDATE preorders SET status='ready', ready_at=?, ready_by='cashier', updated_at=? WHERE id=?`).run(t, t, id)
  } else {
    db.prepare(`UPDATE preorders SET status=?, updated_at=? WHERE id=?`).run(next, t, id)
  }
  return loadOrder(db, id)!
}

/** Кассир уточняет ETA: пересчитываем eta_ready_at от «сейчас» и продлеваем TTL. */
export function setOrderEta(db: Db, id: string, etaMinutes: number): OrderOut {
  const row = db.prepare(`SELECT * FROM preorders WHERE id = ?`).get(id)
  if (!row) throw Object.assign(new Error('not_found'), { code: 'not_found' })
  const status = String(row.status)
  if (!['accepted', 'cooking'].includes(status)) {
    throw Object.assign(new Error('invalid_transition'), { code: 'invalid_transition', from: status })
  }
  const t = nowSec()
  const minutes = Math.min(120, Math.max(1, Math.round(etaMinutes)))
  const eta = t + minutes * 60
  const grace = getPreorderSettings(Number(row.store_id)).pickupGraceMinutes
  const expires = Math.max(Number(row.expires_at) || 0, eta + grace * 60)
  db.prepare('UPDATE preorders SET eta_ready_at=?, expires_at=?, updated_at=? WHERE id=?').run(eta, expires, t, id)
  return loadOrder(db, id)!
}

/** Гость забрал заказ. Статус не меняем (paid остаётся терминальным для кассы). */
export function markPickedUp(db: Db, id: string, userId?: number | null): OrderOut {
  const row = db.prepare(`SELECT * FROM preorders WHERE id = ?`).get(id)
  if (!row) throw Object.assign(new Error('not_found'), { code: 'not_found' })
  // Гость может закрыть только свой заказ; заказ без владельца — не гостевой (P1-4).
  if (userId != null && (row.guest_user_id == null || Number(row.guest_user_id) !== userId)) {
    throw Object.assign(new Error('not_found'), { code: 'not_found' })
  }
  const status = String(row.status)
  if (status !== 'paid' && status !== 'ready') {
    throw Object.assign(new Error('invalid_transition'), { code: 'invalid_transition', from: status })
  }
  const t = nowSec()
  db.prepare('UPDATE preorders SET picked_up_at=COALESCE(picked_up_at, ?), updated_at=? WHERE id=?').run(t, t, id)
  return loadOrder(db, id)!
}

export function rejectOrder(db: Db, id: string, reason: string): void {
  const row = db.prepare(`SELECT * FROM preorders WHERE id = ?`).get(id)
  if (!row) throw Object.assign(new Error('not_found'), { code: 'not_found' })
  const cur = String(row.status)
  if (!['draft', 'accepted', 'cooking'].includes(cur)) {
    throw Object.assign(new Error('invalid_transition'), { code: 'invalid_transition' })
  }
  const t = nowSec()
  db.prepare(`UPDATE preorders SET status = 'rejected', reject_reason = ?, rejected_at = ?, updated_at = ? WHERE id = ?`).run(
    reason || 'rejected',
    t,
    t,
    id,
  )
}

export function cancelDraft(db: Db, id: string, guestUserId?: number | null): void {
  const row = db.prepare(`SELECT * FROM preorders WHERE id = ?`).get(id)
  if (!row) throw Object.assign(new Error('not_found'), { code: 'not_found' })
  if (String(row.status) !== 'draft') throw Object.assign(new Error('invalid_transition'), { code: 'invalid_transition' })
  // Отменить чужой (или бесхозный) заказ гость не может (P1-4).
  if (guestUserId != null && (row.guest_user_id == null || Number(row.guest_user_id) !== guestUserId)) {
    throw Object.assign(new Error('forbidden'), { code: 'forbidden' })
  }
  const t = nowSec()
  db.prepare(`UPDATE preorders SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(t, id)
}

/** Контекст оплаты от кассы: необязательный, но если пришёл — сверяем с заказом (P0-6). */
export type PaymentContext = {
  fiscalDocumentNumber?: string | null
  /** Сумма, которую реально оплатили, в рублях. */
  amountRub?: number | null
}

/**
 * Отметка «оплачен».
 *
 * Идемпотентно: повторный вызов для оплаченного заказа возвращает его же.
 * Отменённый/отклонённый/истёкший заказ оплатить нельзя — иначе отмена «воскресает».
 * Если касса передала фискальный номер или сумму, они сверяются с заказом:
 * чужой/повторный фискальный номер и расхождение суммы — отказ, а не тихое закрытие.
 */
export function markPaid(db: Db, id: string, payment: PaymentContext = {}): OrderOut {
  const row = db.prepare(`SELECT * FROM preorders WHERE id = ?`).get(id)
  if (!row) throw Object.assign(new Error('not_found'), { code: 'not_found' })
  const cur = String(row.status)
  if (cur === 'paid') return loadOrder(db, id)!
  if (!['accepted', 'cooking', 'ready'].includes(cur)) {
    throw Object.assign(new Error('invalid_transition'), { code: 'invalid_transition' })
  }

  const expected = row.quote_total != null ? Number(row.quote_total) : Number(row.estimate_total)
  if (payment.amountRub != null) {
    const paid = Math.round(Number(payment.amountRub))
    if (!Number.isFinite(paid) || paid !== Math.round(expected)) {
      throw Object.assign(new Error('amount_mismatch'), { code: 'amount_mismatch' })
    }
  }

  const fiscal = String(payment.fiscalDocumentNumber ?? '').trim() || null
  if (fiscal) {
    const used = db.prepare('SELECT id FROM preorders WHERE fiscal_document_number=? AND id<>?')
      .get(fiscal, id) as { id: string } | undefined
    if (used) throw Object.assign(new Error('duplicate_fiscal'), { code: 'duplicate_fiscal' })
  }

  const t = nowSec()
  db.prepare(`UPDATE preorders SET status='paid', paid_at=?, updated_at=?, fiscal_document_number=?, paid_amount=? WHERE id=?`)
    .run(t, t, fiscal, payment.amountRub != null ? Math.round(Number(payment.amountRub)) : null, id)
  return loadOrder(db, id)!
}

/** Схема предзаказов создаётся один раз на соединение, а не на каждый запрос (P2-1). */
const preorderSchemaReady = new WeakSet<object>()

export function ensurePreorderTables(db: Db) {
  const key = db as unknown as object
  if (preorderSchemaReady.has(key)) return
  db.exec(`
CREATE TABLE IF NOT EXISTS preorders (
  id TEXT PRIMARY KEY,
  short_code TEXT NOT NULL,
  store_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  card_id TEXT,
  guest_user_id INTEGER,
  estimate_total INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  cooking_at INTEGER,
  ready_at INTEGER,
  paid_at INTEGER,
  rejected_at INTEGER,
  reject_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  eta_ready_at INTEGER,
  picked_up_at INTEGER,
  ready_by TEXT,
  fiscal_document_number TEXT,
  paid_amount INTEGER
);
CREATE TABLE IF NOT EXISTS preorder_bans (
  user_id INTEGER PRIMARY KEY,
  until INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'no_show',
  order_id TEXT,
  created_at INTEGER NOT NULL,
  lifted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_preorders_store_status ON preorders(store_id, status);
CREATE INDEX IF NOT EXISTS idx_preorders_short ON preorders(store_id, short_code);
CREATE TABLE IF NOT EXISTS preorder_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  evotor_product_uuid TEXT,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  volume_label TEXT,
  config_text TEXT NOT NULL DEFAULT '',
  unit_price_estimate INTEGER NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS preorder_item_modifiers (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  modifier_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price_estimate INTEGER NOT NULL DEFAULT 0,
  send_to_receipt INTEGER NOT NULL DEFAULT 0,
  evotor_uuid TEXT
);
`)
  // Старые БД (до 043/044): догоняем колонки, чтобы runtime-фолбэк не падал.
  const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
  const preorderCols = cols('preorders')
  if (!preorderCols.includes('eta_ready_at')) db.exec('ALTER TABLE preorders ADD COLUMN eta_ready_at INTEGER')
  if (!preorderCols.includes('picked_up_at')) db.exec('ALTER TABLE preorders ADD COLUMN picked_up_at INTEGER')
  if (!preorderCols.includes('ready_by')) db.exec('ALTER TABLE preorders ADD COLUMN ready_by TEXT')
  if (!cols('preorder_item_modifiers').includes('evotor_uuid')) {
    db.exec('ALTER TABLE preorder_item_modifiers ADD COLUMN evotor_uuid TEXT')
  }
  if (!preorderCols.includes('fiscal_document_number')) db.exec('ALTER TABLE preorders ADD COLUMN fiscal_document_number TEXT')
  if (!preorderCols.includes('paid_amount')) db.exec('ALTER TABLE preorders ADD COLUMN paid_amount INTEGER')
  preorderSchemaReady.add(key)
}
