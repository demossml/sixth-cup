/**
 * Бонус гостя в предзаказе: подарок / ваучер / кэшбэк.
 *
 * Правила (продуктовые, зафиксированы):
 *  • одно правило за раз — подарок ИЛИ ваучер ИЛИ кэшбэк;
 *  • подарок списывает один самый дорогой напиток, у которого `free_eligible = 1`;
 *  • ваучер `percent` даёт скидку в процентах от суммы позиций, `fixed` — фиксированную сумму
 *    (в БД хранится в копейках, в расчёте — в рублях);
 *  • кэшбэк — не больше остатка и не больше суммы заказа;
 *  • расчёт всегда серверный, PWA только показывает; касса применяет по `sc.ord`
 *    (резерв лояльности привязан к заказу, скидку в APK никто не считает).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import { activeVouchers, todayDay } from '../vouchers/service'
import { freeEarned } from '../loyalty/rules'
import { config } from '../../config'

type Db = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => Record<string, unknown> | undefined
    all: (...args: unknown[]) => Record<string, unknown>[]
    run: (...args: unknown[]) => { changes: number }
  }
  /** Есть у better-sqlite3; в тестовых обёртках может отсутствовать. */
  transaction?: <T>(fn: () => T) => () => T
}

export type BenefitKind = 'gift' | 'voucher' | 'cashback'
export type BenefitIn = { kind: BenefitKind; voucherId?: number | null } | null

export type BenefitOut = { kind: BenefitKind; title: string; amountRub: number; voucherId?: number | null }

export type QuoteItem = { productId: string; quantity: number; unitPriceEstimate: number; sum: number }

export type QuoteAvailable = {
  gift: boolean
  cashbackRub: number
  vouchers: { id: number; title: string; kind: 'p' | 'f'; value: number; expiresDay: number }[]
}

export type QuoteResult = {
  ok: true
  items: QuoteItem[]
  subtotal: number
  discount: number
  total: number
  benefit: BenefitOut | null
  available: QuoteAvailable
  /** Подпись расчёта: заказ принимается только с актуальным quote. */
  quoteToken: string
  expiresAt: string
}

const nowSec = () => Math.floor(Date.now() / 1000)
const round = (n: number) => Math.round(n)

export class BenefitError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

type ProductRow = { id: number; name: string; price: number; free_eligible: number | null; available: number }

function productOf(db: Db, id: string): ProductRow | undefined {
  return db.prepare('SELECT id, name, price, free_eligible, available FROM products WHERE id=? OR cast(id as text)=?')
    .get(Number(id) || -1, String(id)) as ProductRow | undefined
}

/** Модификатор в позиции: одна запись = одно добавление (как в `cart.modifiers`). */
export type QuoteModifierIn = { modifierId: string | number }

export type QuoteItemIn = {
  productId: string
  quantity: number
  volumeId?: string | null
  /** Молоко/сиропы/топпинги: id из справочника `modifiers`, по записи на единицу. */
  modifiers?: QuoteModifierIn[]
}

function modifierPrice(db: Db, modifierId: string | number): number | null {
  const row = db.prepare('SELECT price, available FROM modifiers WHERE id=?').get(Number(modifierId)) as
    | { price: number; available: number }
    | undefined
  if (!row || Number(row.available) === 0) return null
  return Number(row.price) || 0
}

/**
 * Сумма и позиции для quote: цена SKU + платные модификаторы (молоко, добавки).
 * Клиент передаёт только id и количество — цены всегда серверные.
 */
function priceItems(db: Db, items: QuoteItemIn[]): QuoteItem[] {
  return items.map((it) => {
    const skuId = it.volumeId ?? it.productId
    const p = productOf(db, String(skuId))
    if (!p || Number(p.available) === 0) {
      throw new BenefitError('product_unavailable', `Позиция недоступна: ${skuId}`)
    }
    const quantity = Math.max(1, Math.min(99, Number(it.quantity) || 1))
    let unitPriceEstimate = Number(p.price) || 0
    for (const m of it.modifiers ?? []) {
      const price = modifierPrice(db, m.modifierId)
      // Неизвестный/выключенный модификатор в сумме не участвует: касса посчитает по своему каталогу.
      if (price != null) unitPriceEstimate += price
    }
    return { productId: String(skuId), quantity, unitPriceEstimate, sum: unitPriceEstimate * quantity }
  })
}

function userOf(db: Db, userId: number): { id: number; card_id: string; cashback_balance: number } | undefined {
  return db.prepare('SELECT id, card_id, cashback_balance FROM users WHERE id=?').get(userId) as
    | { id: number; card_id: string; cashback_balance: number }
    | undefined
}

/** Доступные правила для карточки корзины. */
export function benefitAvailable(db: Db, userId: number): QuoteAvailable {
  const user = userOf(db, userId)
  if (!user) return { gift: false, cashbackRub: 0, vouchers: [] }
  const card = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?').get(userId) as
    | { paid_total: number; free_used: number }
    | undefined
  const gift = Math.max(0, freeEarned(card?.paid_total ?? 0) - (card?.free_used ?? 0)) > 0
  const vouchers = activeVouchers(userId).map(([id, kind, value, expiresDay]) => {
    const row = db.prepare('SELECT title FROM vouchers WHERE id=?').get(id) as { title: string } | undefined
    return { id, title: row?.title ?? 'Ваучер', kind, value, expiresDay }
  })
  return { gift, cashbackRub: Math.floor((Number(user.cashback_balance) || 0) / 100), vouchers }
}

function voucherTitle(db: Db, id: number): string {
  const row = db.prepare('SELECT title FROM vouchers WHERE id=?').get(id) as { title: string } | undefined
  return row?.title ?? 'Ваучер'
}

/** Скидка от выбранного правила. `null` — без бонуса. */
function applyBenefit(
  db: Db,
  userId: number,
  items: QuoteItem[],
  benefit: BenefitIn,
  subtotal: number,
  available: QuoteAvailable,
): { discount: number; benefit: BenefitOut | null } {
  if (!benefit) return { discount: 0, benefit: null }
  if (benefit.kind === 'gift') {
    if (!available.gift) throw new BenefitError('benefit_not_available', 'Подарок пока недоступен')
    let best: ProductRow | null = null
    for (const it of items) {
      const p = productOf(db, it.productId)
      if (!p || Number(p.free_eligible) !== 1) continue
      if (!best || Number(p.price) > Number(best.price)) best = p
    }
    if (!best) throw new BenefitError('benefit_not_available', 'В заказе нет позиции, которая может быть подарком')
    const amountRub = Math.min(subtotal, Number(best.price) || 0)
    return { discount: amountRub, benefit: { kind: 'gift', title: `Подарок: ${best.name}`, amountRub } }
  }
  if (benefit.kind === 'voucher') {
    const id = Number(benefit.voucherId)
    const v = available.vouchers.find((x) => x.id === id)
    if (!v) throw new BenefitError('benefit_stale', 'Ваучер больше недоступен — обновите корзину')
    const amountRub = v.kind === 'p' ? round((subtotal * v.value) / 100) : Math.min(subtotal, Math.round(v.value))
    return { discount: Math.min(subtotal, amountRub), benefit: { kind: 'voucher', title: voucherTitle(db, id), amountRub: Math.min(subtotal, amountRub), voucherId: id } }
  }
  if (benefit.kind === 'cashback') {
    if (available.cashbackRub <= 0) throw new BenefitError('benefit_not_available', 'Кэшбэка пока нет')
    const amountRub = Math.min(subtotal, available.cashbackRub)
    return { discount: amountRub, benefit: { kind: 'cashback', title: 'Кэшбэк', amountRub } }
  }
  throw new BenefitError('bad_request', 'Неизвестный бонус')
}

// —— Подпись расчёта ——

const secret = () => config.orderQrSecret || config.jwtSecret

export type QuotePayload = {
  v: 1
  t: 'q'
  uid: number
  storeId: number
  subtotal: number
  discount: number
  total: number
  benefit: BenefitOut | null
  items: { productId: string; quantity: number; unitPriceEstimate: number }[]
  exp: number
  nonce: string
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url')
}

export function signQuote(payload: QuotePayload): string {
  const body = b64(JSON.stringify(payload))
  return `q1.${body}.${sign(body)}`
}

export function readQuote(token: string): QuotePayload | null {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || parts[0] !== 'q1') return null
  const [, body, sig] = parts
  const expected = sign(body)
  if (sig.length !== expected.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as QuotePayload
    if (payload.t !== 'q' || payload.exp < nowSec()) return null
    return payload
  } catch {
    return null
  }
}

/** Расчёт корзины: сумма, скидка по выбранному бонусу и подписанный quote. */
export function quoteOrder(
  db: Db,
  opts: {
    userId: number
    storeId: number
    items: QuoteItemIn[]
    benefit: BenefitIn
    ttlSec?: number
  },
): QuoteResult {
  if (!opts.items?.length) throw new BenefitError('empty_items', 'Корзина пуста')
  const items = priceItems(db, opts.items)
  const subtotal = items.reduce((s, it) => s + it.sum, 0)
  const available = benefitAvailable(db, opts.userId)
  const { discount, benefit } = applyBenefit(db, opts.userId, items, opts.benefit, subtotal, available)
  const total = Math.max(0, subtotal - discount)
  const ttl = Math.max(60, Math.min(1800, opts.ttlSec ?? 600))
  const exp = nowSec() + ttl
  const quoteToken = signQuote({
    v: 1,
    t: 'q',
    uid: opts.userId,
    storeId: opts.storeId,
    subtotal,
    discount,
    total,
    benefit,
    items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPriceEstimate: i.unitPriceEstimate })),
    exp,
    nonce: randomBytes(6).toString('base64url'),
  })
  return {
    ok: true,
    items,
    subtotal,
    discount,
    total,
    benefit,
    available,
    quoteToken,
    expiresAt: new Date(exp * 1000).toISOString(),
  }
}

/**
 * Резерв льгот под заказ: одна запись в `loyalty_reservations`, привязанная к заказу
 * через `preorders.reservation_id`. Касса потребит её по `sc.ord`.
 */
export function reserveForOrder(
  db: Db,
  opts: { userId: number; storeId: number; benefit: BenefitOut | null; total: number },
): string | null {
  if (!opts.benefit) return null
  const user = userOf(db, opts.userId)
  if (!user) return null
  const storeUuid = (
    db.prepare('SELECT store_uuid FROM evotor_stores WHERE local_store_id=? LIMIT 1').get(opts.storeId) as
      | { store_uuid: string }
      | undefined
  )?.store_uuid ?? null
  const t = nowSec()
  const ttl = Math.max(60, config.reservationTtlSec || 600)
  const id = 'R-' + randomBytes(9).toString('base64url')
  const work = () => {
    // Гость мог держать резерв с прошлой попытки — освобождаем, заказ один активный.
    db.prepare(`UPDATE loyalty_reservations SET status='EXPIRED' WHERE card_id=? AND status='RESERVED'`).run(user.card_id)
    const free = opts.benefit?.kind === 'gift' ? 1 : 0
    const cashback = opts.benefit?.kind === 'cashback' ? Math.min(Number(user.cashback_balance) || 0, opts.benefit.amountRub * 100) : 0
    const voucherIds = opts.benefit?.kind === 'voucher' && opts.benefit.voucherId ? JSON.stringify([opts.benefit.voucherId]) : '[]'
    db.prepare(
      `INSERT INTO loyalty_reservations(id,card_id,benefit_free,benefit_cb,benefit_voucher_ids,store_uuid,device_uuid,status,created_at,expires_at)
       VALUES(?,?,?,?,?,?,NULL,'RESERVED',?,?)`,
    ).run(id, user.card_id, free, cashback, voucherIds, storeUuid, t, t + ttl)
  }
  if (db.transaction) db.transaction(work)()
  else work()
  return id
}

/** Освободить резерв отменённого/истёкшего заказа (льгота возвращается гостю). */
export function releaseReservation(db: Db, reservationId: string | null | undefined): void {
  if (!reservationId) return
  db.prepare(`UPDATE loyalty_reservations SET status='EXPIRED' WHERE id=? AND status='RESERVED'`).run(reservationId)
}

/** Расшифровать `benefit_json`, сохранённый в заказе. */
export function parseBenefit(raw: unknown): BenefitOut | null {
  if (!raw) return null
  try {
    const b = JSON.parse(String(raw)) as BenefitOut
    if (!b || typeof b !== 'object' || !b.kind) return null
    return { kind: b.kind, title: String(b.title ?? ''), amountRub: Number(b.amountRub) || 0, voucherId: b.voucherId ?? null }
  } catch {
    return null
  }
}

export const benefitInternals = { priceItems, applyBenefit, todayDay }
