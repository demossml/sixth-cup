import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { CreateOrderBody, ItemOut, ModifierOut, OrderOut, PreorderStatus } from './types'
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
  const fresh = db.prepare(`SELECT * FROM preorders WHERE id = ?`).get(id)!
  const items = db
    .prepare(`SELECT * FROM preorder_items WHERE order_id = ? ORDER BY position ASC`)
    .all(id)
  const outItems: ItemOut[] = items.map((it) => {
    const mods = db
      .prepare(`SELECT * FROM preorder_item_modifiers WHERE order_item_id = ?`)
      .all(String(it.id))
    const modifiers: ModifierOut[] = mods.map((m) => ({
      group: String(m.group_key),
      id: String(m.modifier_id),
      name: String(m.name),
      priceEstimate: Number(m.price_estimate) || 0,
      sendToReceipt: Number(m.send_to_receipt) === 1,
    }))
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
  return {
    id: String(fresh.id),
    shortCode: String(fresh.short_code),
    storeId: Number(fresh.store_id),
    status: String(fresh.status) as PreorderStatus,
    createdAt: iso(Number(fresh.created_at)),
    expiresAt: iso(Number(fresh.expires_at)),
    estimateTotal: Number(fresh.estimate_total),
    currency: String(fresh.currency || 'RUB'),
    cardId: fresh.card_id ? String(fresh.card_id) : null,
    items: outItems,
    warnings: [],
  }
}

function expireIfNeeded(db: Db, row: Record<string, unknown>) {
  const status = String(row.status)
  if (!ACTIVE_STATUSES.includes(status as PreorderStatus)) return
  if (Number(row.expires_at) >= nowSec()) return
  db.prepare(`UPDATE preorders SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('draft','accepted','cooking','ready')`).run(
    nowSec(),
    String(row.id),
  )
}

/** Resolve product price/name from products table; volume/modifiers simplified for MVP mapping. */
function resolveLine(
  db: Db,
  item: CreateOrderBody['items'][0],
): { name: string; unit: number; evotor: string | null; volumeLabel: string | null; configText: string; mods: ModifierOut[] } {
  const productId = String(item.productId)
  const p =
    db.prepare(`SELECT id, name, price, evotor_uuid, available FROM products WHERE id = ? OR cast(id as text) = ?`).get(
      Number(productId) || -1,
      productId,
    ) || db.prepare(`SELECT id, name, price, evotor_uuid, available FROM products WHERE name = ?`).get(productId)

  if (!p || Number(p.available) === 0) {
    throw Object.assign(new Error('product_unavailable'), { code: 'product_unavailable', productId })
  }

  const qty = Math.max(1, Math.min(99, Number(item.quantity) || 1))
  void qty
  let unit = Number(p.price) || 0
  const mods: ModifierOut[] = []
  const configParts: string[] = []
  let volumeLabel: string | null = item.volumeId ? String(item.volumeId) : null

  for (const m of item.modifiers || []) {
    const name = String(m.modifierId)
    const priceEstimate = 0
    const sendToReceipt = m.groupKey !== 'milk' || name !== 'regular'
    mods.push({
      group: String(m.groupKey),
      id: String(m.modifierId),
      name,
      priceEstimate,
      sendToReceipt,
    })
    configParts.push(name)
    unit += priceEstimate
  }

  if (volumeLabel) configParts.unshift(volumeLabel)

  return {
    name: String(p.name),
    unit,
    evotor: p.evotor_uuid ? String(p.evotor_uuid) : null,
    volumeLabel,
    configText: configParts.join(' · '),
    mods,
  }
}

export function createDraftOrder(
  db: Db,
  body: CreateOrderBody,
  opts: { guestUserId?: number | null; secret: string },
): { order: OrderOut; qrPayload: string } {
  const storeId = Number(body.storeId)
  if (!Number.isFinite(storeId)) throw Object.assign(new Error('invalid_store'), { code: 'invalid_store' })
  const store = db.prepare(`SELECT id FROM stores WHERE id = ?`).get(storeId)
  if (!store) throw Object.assign(new Error('store_not_found'), { code: 'store_not_found' })
  if (!body.items?.length) throw Object.assign(new Error('empty_items'), { code: 'empty_items' })

  const id = randomUUID()
  const shortCode = genShortCode(db, storeId)
  const created = nowSec()
  const expires = created + 30 * 60
  let total = 0
  const resolved = body.items.map((it, idx) => {
    const r = resolveLine(db, it)
    const quantity = Math.max(1, Math.min(99, Number(it.quantity) || 1))
    total += r.unit * quantity
    return { ...r, quantity, productId: String(it.productId), position: idx }
  })

  db.prepare(
    `INSERT INTO preorders (id, short_code, store_id, status, card_id, guest_user_id, estimate_total, currency, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, 'RUB', ?, ?, ?)`,
  ).run(id, shortCode, storeId, body.cardId || null, opts.guestUserId ?? null, total, expires, created, created)

  for (const r of resolved) {
    const lineId = randomUUID()
    db.prepare(
      `INSERT INTO preorder_items (id, order_id, product_id, evotor_product_uuid, name, quantity, volume_label, config_text, unit_price_estimate, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(lineId, id, r.productId, r.evotor, r.name, r.quantity, r.volumeLabel, r.configText, r.unit, r.position)
    for (const m of r.mods) {
      db.prepare(
        `INSERT INTO preorder_item_modifiers (id, order_item_id, group_key, modifier_id, name, price_estimate, send_to_receipt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), lineId, m.group, m.id, m.name, m.priceEstimate, m.sendToReceipt ? 1 : 0)
    }
  }

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
  const cur = String(db.prepare(`SELECT status FROM preorders WHERE id = ?`).get(id)?.status)
  const allowed = ALLOWED_TRANSITIONS[cur] || []
  if (!allowed.includes(next)) {
    throw Object.assign(new Error('invalid_transition'), { code: 'invalid_transition', from: cur, to: next })
  }
  const t = nowSec()
  const tsCol = next === 'accepted' ? 'accepted_at' : next === 'cooking' ? 'cooking_at' : next === 'ready' ? 'ready_at' : null
  if (tsCol) {
    db.prepare(`UPDATE preorders SET status = ?, ${tsCol} = ?, updated_at = ? WHERE id = ?`).run(next, t, t, id)
  } else {
    db.prepare(`UPDATE preorders SET status = ?, updated_at = ? WHERE id = ?`).run(next, t, id)
  }
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
  if (guestUserId != null && row.guest_user_id != null && Number(row.guest_user_id) !== guestUserId) {
    throw Object.assign(new Error('forbidden'), { code: 'forbidden' })
  }
  const t = nowSec()
  db.prepare(`UPDATE preorders SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(t, id)
}

export function markPaid(db: Db, id: string): OrderOut {
  const row = db.prepare(`SELECT * FROM preorders WHERE id = ?`).get(id)
  if (!row) throw Object.assign(new Error('not_found'), { code: 'not_found' })
  const cur = String(row.status)
  if (cur === 'paid') return loadOrder(db, id)!
  if (!['accepted', 'cooking', 'ready'].includes(cur)) {
    throw Object.assign(new Error('invalid_transition'), { code: 'invalid_transition' })
  }
  const t = nowSec()
  db.prepare(`UPDATE preorders SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?`).run(t, t, id)
  return loadOrder(db, id)!
}

export function ensurePreorderTables(db: Db) {
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
  updated_at INTEGER NOT NULL
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
  send_to_receipt INTEGER NOT NULL DEFAULT 0
);
`)
}
