import { randomBytes } from 'node:crypto'
import { db } from '../../db'
import { config } from '../../config'
import { verifyServerToken } from '../../lib/crypto'
import { normalizeCardCode } from './proof'
import { freeEarned } from './rules'
import { log, shortId } from '../../lib/logBuffer'
import { vouchersForResolve } from '../vouchers/service'
import type { ResolveVoucher } from '../vouchers/service'
import { bpsToPercent, effectiveEarnBps } from './settings'
import { findUserByPhone } from './customers'

export type ResolveInput = {
  /** QR-токен или числовой код карты. Может быть пустым, если передан `phone`. */
  code?: string
  /** Альтернатива коду: кассир ввёл телефон клиента на авторизованной кассе. */
  phone?: string
  storeUuid?: string
  deviceUuid?: string
}

export type ResolveResult =
  | { ok: false; error: 'invalid_card' | 'card_not_found' | 'card_blocked' }
  | {
      ok: true
      cardCode: string
      kind: 'token' | 'code'
      paidCups: number
      cupsForFree: number
      /** Свободные чашки по подарку. В bonus mode подарок выключен → 0. */
      freeAvailable: number
      cashback: number
      /** Баланс кэшбэка в копейках (то же, что `cashback`, но имя явно про единицы). */
      balanceKopecks: number
      /** Процент начисления для этого гостя (individual → global), в процентах. */
      effectiveEarnPercent: number
      /** Cashback in kopecks that this reservation allows to spend. */
      cashbackReserved: number
      reservationId: string | null
      reservationExpiresAt: number | null
      /** FREE_RESERVED | FREE_ALREADY_RESERVED | NONE */
      freeStatus: 'RESERVED' | 'ALREADY_RESERVED' | 'NONE'
      /** Ваучеры к предъявлению (только QR: числовой код ничего не гасит и не показывает). */
      vouchers: ResolveVoucher[]
      /**
       * `false` — касса может только идентифицировать карту и показать цифры:
       * резерв/списание кешбэка и ваучеров недоступны (числовой код карты).
       * `true` — подписанный QR или телефон, введённый на авторизованной кассе.
       */
      canRedeem: boolean
    }

type UserRow = { id: number; card_id: string; card_code: string; cashback_balance: number }

function findUser(code: string): { user: UserRow; kind: 'token' | 'code' } | 'invalid' | 'missing' {
  const raw = code.trim()
  if (raw.includes('.')) {
    const p = verifyServerToken(raw)
    if (!p || p.t !== 'c' || p.ver !== 2 || typeof p.id !== 'string') return 'invalid'
    const user = db.prepare('SELECT id, card_id, card_code, cashback_balance FROM users WHERE card_id=?').get(p.id) as UserRow | undefined
    return user ? { user, kind: 'token' } : 'missing'
  }
  const digits = normalizeCardCode(raw)
  if (!digits) return 'invalid'
  const user = db.prepare('SELECT id, card_id, card_code, cashback_balance FROM users WHERE card_code=?').get(digits) as UserRow | undefined
  return user ? { user, kind: 'code' } : 'missing'
}

/** Идентификация по телефону (касса нашла клиента через lookup). */
function findByPhone(phone: string): { user: UserRow; kind: 'phone' } | 'invalid' | 'missing' {
  const row = findUserByPhone(phone)
  if (!row) return 'missing'
  const user = db.prepare('SELECT id, card_id, card_code, cashback_balance FROM users WHERE id=?').get(row.id) as
    | UserRow
    | undefined
  return user ? { user, kind: 'phone' } : 'missing'
}

export function newReservationId(): string {
  return 'R-' + randomBytes(9).toString('base64url')
}

/**
 * Identify the customer. Числовой код/телефон — identify + display, QR — identify + reserve.
 *
 * Политика списания:
 *  • `QR` (подписанный токен) — идентификация + резерв, списание разрешено;
 *  • `phone` — списание разрешено сразу: телефон вводит кассир на авторизованной
 *    кассе (`evotorProxyStrict`/device token), дополнительных подтверждений от гостя нет;
 *  • числовой `code` — только показ (баланс/прогресс), `canRedeem: false`:
 *    номер карты — слабый секрет, перебор закрыт CSPRNG и лимитом по коду.
 *
 * `FREE_GIFT` выдаётся только в старом контуре (`LOYALTY_BONUS_MODE=0`).
 */
export function resolveAndReserve(input: ResolveInput, now = Date.now()): ResolveResult {
  const code = String(input.code ?? '').trim()
  const found = code ? findUser(code) : input.phone ? findByPhone(input.phone) : 'invalid'
  if (found === 'invalid') return { ok: false, error: 'invalid_card' }
  if (found === 'missing') return { ok: false, error: 'card_not_found' }
  const { user, kind } = found
  if (db.prepare('SELECT 1 FROM card_denylist WHERE card_id=? AND released_at IS NULL').get(user.card_id)) return { ok: false, error: 'card_blocked' }

  const card = (db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?').get(user.id) ?? { paid_total: 0, free_used: 0 }) as {
    paid_total: number; free_used: number
  }
  const freeAvailCard = Math.max(0, freeEarned(card.paid_total) - card.free_used)
  const bonusMode = config.loyaltyBonusMode
  const balance = Math.max(0, Number(user.cashback_balance) || 0)
  const base = {
    ok: true as const,
    cardCode: user.card_code,
    // Проводной контракт APK знает только `token | code`; телефон отдаём как `code`.
    kind: (kind === 'token' ? 'token' : 'code') as 'token' | 'code',
    paidCups: card.paid_total % config.cupsForFree,
    cupsForFree: config.cupsForFree,
    // В bonus mode подарок выключен: показывать «свободные чашки» кассе нельзя.
    freeAvailable: bonusMode ? 0 : freeAvailCard,
    cashback: balance,
    balanceKopecks: balance,
    effectiveEarnPercent: bpsToPercent(effectiveEarnBps(db, user.id)),
  }
  if (kind === 'code') {
    // P0-02: числовой код — только идентификация и показ баланса. Никакого резерва,
    // ваучеров и `canRedeem`: номер карты слабый, защита — CSPRNG и лимит по коду.
    return {
      ...base,
      cashbackReserved: 0,
      reservationId: null,
      reservationExpiresAt: null,
      freeStatus: 'NONE',
      vouchers: [],
      canRedeem: false,
    }
  }

  const nowSec = Math.floor(now / 1000)
  const ttl = Math.max(30, config.reservationTtlSec)
  return db.transaction(() => {
    db.prepare(`UPDATE loyalty_reservations SET status='EXPIRED' WHERE card_id=? AND status='RESERVED' AND expires_at<=?`).run(user.card_id, nowSec)
    // D-09: ваучеры уходят кассе только при включённом флаге; id запоминаем в резерве,
    // чтобы SellHandler мог проверить, что касса предъявила именно выданный ваучер.
    const offer = config.vouchersInResolve ? vouchersForResolve(user.id) : []
    const offerIds = JSON.stringify(offer.map((v) => v.id))
    const active = db.prepare(`SELECT id, expires_at, benefit_free, benefit_cb FROM loyalty_reservations WHERE card_id=? AND status='RESERVED'`)
      .get(user.card_id) as { id: string; expires_at: number; benefit_free: number; benefit_cb: number } | undefined
    if (active) {
      // Same till asking again (rescan) may refresh its own hold; other tills see "already reserved".
      const mine = db.prepare('SELECT device_uuid, store_uuid FROM loyalty_reservations WHERE id=?').get(active.id) as { device_uuid: string | null; store_uuid: string | null }
      const same = (input.deviceUuid ?? '') === (mine.device_uuid ?? '') && (input.storeUuid ?? '') === (mine.store_uuid ?? '')
      if (same) {
        db.prepare('UPDATE loyalty_reservations SET expires_at=?, benefit_voucher_ids=? WHERE id=?')
          .run(nowSec + ttl, offerIds, active.id)
        return { ...base, freeAvailable: base.freeAvailable && active.benefit_free ? 1 : 0, cashbackReserved: active.benefit_cb, reservationId: active.id, reservationExpiresAt: nowSec + ttl, freeStatus: active.benefit_free ? 'RESERVED' as const : 'NONE' as const, vouchers: offer, canRedeem: true }
      }
      return { ...base, freeAvailable: 0, cashback: 0, balanceKopecks: 0, cashbackReserved: 0, reservationId: null, reservationExpiresAt: null, freeStatus: 'ALREADY_RESERVED' as const, vouchers: [], canRedeem: true }
    }
    const id = newReservationId()
    // bonus mode: подарок не резервируем, держим весь баланс под кэшбэк (clamp — на SELL).
    const free = !bonusMode && freeAvailCard > 0 ? 1 : 0
    const cb = balance
    db.prepare(`INSERT INTO loyalty_reservations(id,card_id,benefit_free,benefit_cb,benefit_voucher_ids,store_uuid,device_uuid,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?, 'RESERVED', ?,?)`)
      .run(id, user.card_id, free, cb, offerIds, input.storeUuid ?? null, input.deviceUuid ?? null, nowSec, nowSec + ttl)
    return { ...base, freeAvailable: free, cashbackReserved: cb, reservationId: id, reservationExpiresAt: nowSec + ttl, freeStatus: free ? 'RESERVED' as const : 'NONE' as const, vouchers: offer, canRedeem: true }
  })()
}

/**
 * Льготы, которые резерв разрешает этому чеку. `voucherIds` — ваучеры, которые кассе
 * отдавались вместе с резервом (см. `loyalty_reservations.benefit_voucher_ids`).
 */
export type ConsumedBenefits = { free: number; cb: number; voucherIds: number[] }

function parseVoucherIds(raw: unknown): number[] {
  try {
    const a = JSON.parse(String(raw ?? '[]'))
    return Array.isArray(a) ? a.filter((x): x is number => Number.isInteger(x) && x > 0) : []
  } catch { return [] }
}

/**
 * Called by SellHandler. Returns the benefits the reservation allows for this card.
 * A reservation that expired before the receipt was polled may still be honoured
 * (the till was slow), but never twice: the first consumer wins and the card state clamps the rest.
 */
export function consumeReservation(conn: typeof db, opId: string | null | undefined, cardId: string, docStore: string, docId: string, now = Date.now()): ConsumedBenefits {
  if (!opId) return { free: 0, cb: 0, voucherIds: [] }
  const row = conn.prepare(`SELECT status, benefit_free, benefit_cb, benefit_voucher_ids, doc_store, doc_id FROM loyalty_reservations WHERE id=? AND card_id=?`)
    .get(opId, cardId) as
    | {
        status: string; benefit_free: number; benefit_cb: number; benefit_voucher_ids: string | null
        doc_store: string | null; doc_id: string | null
      }
    | undefined
  if (!row) return { free: 0, cb: 0, voucherIds: [] }
  // Повторная обработка того же чека (retry после сбоя транзакции): резерв уже помечен этим
  // документом — возвращаем те же льготы, иначе гость теряет бесплатную чашку при повторе.
  if (row.status === 'CONSUMED' && row.doc_store === docStore && row.doc_id === docId) {
    return { free: row.benefit_free, cb: row.benefit_cb, voucherIds: parseVoucherIds(row.benefit_voucher_ids) }
  }
  if (row.status !== 'RESERVED' && row.status !== 'EXPIRED') return { free: 0, cb: 0, voucherIds: [] }
  const r = conn.prepare(`UPDATE loyalty_reservations SET status='CONSUMED', consumed_at=?, doc_store=?, doc_id=? WHERE id=? AND status IN ('RESERVED','EXPIRED')`)
    .run(now, docStore, docId, opId)
  if (r.changes !== 1) return { free: 0, cb: 0, voucherIds: [] }
  log.info('loyalty reservation consumed', { res: shortId(opId, 6), free: row.benefit_free, cbKop: row.benefit_cb, late: row.status === 'EXPIRED' ? 1 : 0 })
  return { free: row.benefit_free, cb: row.benefit_cb, voucherIds: parseVoucherIds(row.benefit_voucher_ids) }
}

export function expireStaleReservations(now = Date.now()): number {
  const n = db.prepare(`UPDATE loyalty_reservations SET status='EXPIRED' WHERE status='RESERVED' AND expires_at<=?`).run(Math.floor(now / 1000)).changes
  if (n > 0) log.info('loyalty reservations expired', { count: n })
  return n
}
