/**
 * Клиент по телефону: поиск и регистрация с кассы (BONUS-LOYALTY, вариант B).
 *
 * Кассир может выдать карту по номеру телефона, не требуя установки PWA. Начисления
 * идут на `cashback_balance`, история — в `loyalty_ledger`. Регистрация требует
 * согласия на обработку персональных данных (`pdConsent === true` + версия).
 *
 * Идемпотентность: UNIQUE `users.phone` + поиск перед вставкой. Повторный вызов с тем же
 * номером возвращает того же пользователя (`created: false`), а не создаёт дубль.
 */
import { randomBytes } from 'node:crypto'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { log } from '../../lib/logBuffer'
import { effectiveEarnBps, earnSourceOf } from './settings'
import { ensureCard } from './proof'
import { isGuestPhone, maskPhone, nicknameFromPhone, normalizePhoneRu } from './phone'

export type CustomerView = {
  userId: number
  cardCode: string
  cardId: string
  /** Только маска: полный номер не уходит ни кассе, ни в UI. */
  phoneMasked: string
  balanceKopecks: number
  effectiveEarnPercent: number
  earnSource: 'individual' | 'global'
  pdConsentAt: number | null
  pdConsentVersion: string | null
}

type UserRow = {
  id: number
  card_id: string | null
  card_code: string | null
  cashback_balance: number
  phone: string
  pd_consent_at: number | null
  pd_consent_version: string | null
}

function viewOf(user: UserRow): CustomerView {
  ensureCard(user.id)
  const fresh = db
    .prepare('SELECT id, card_id, card_code, cashback_balance, phone, pd_consent_at, pd_consent_version FROM users WHERE id=?')
    .get(user.id) as UserRow
  return {
    userId: fresh.id,
    cardCode: String(fresh.card_code ?? ''),
    cardId: String(fresh.card_id ?? ''),
    phoneMasked: maskPhone(fresh.phone),
    balanceKopecks: Math.max(0, Number(fresh.cashback_balance) || 0),
    effectiveEarnPercent: Math.round(effectiveEarnBps(db, fresh.id)) / 100,
    earnSource: earnSourceOf(db, fresh.id),
    pdConsentAt: fresh.pd_consent_at ?? null,
    pdConsentVersion: fresh.pd_consent_version ?? null,
  }
}

/** Гость по номеру телефона или `null`. Гостевые `guest:<hex>` не ищутся. */
export function findUserByPhone(input: string): UserRow | null {
  const phone = normalizePhoneRu(input)
  if (!phone) return null
  return (
    (db
      .prepare('SELECT id, card_id, card_code, cashback_balance, phone, pd_consent_at, pd_consent_version FROM users WHERE phone=?')
      .get(phone) as UserRow | undefined) ?? null
  )
}

/** Публичное представление гостя для кассы. */
export function customerByPhone(input: string): CustomerView | null {
  const user = findUserByPhone(input)
  return user ? viewOf(user) : null
}

export type RegisterResult = { customer: CustomerView; created: boolean }

/**
 * Регистрация/выдача карты по телефону с согласием на обработку ПД.
 * Без `pdConsent: true` и непустой версии согласия → 400.
 */
export function registerByPhone(input: {
  phone: string
  pdConsent?: boolean
  pdConsentVersion?: string | null
  source?: string
}): RegisterResult {
  if (input.pdConsent !== true) throw bad('Нужно согласие на обработку персональных данных', 400)
  const version = String(input.pdConsentVersion ?? '').trim()
  if (!version) throw bad('Не указана версия согласия на обработку персональных данных', 400)
  const phone = normalizePhoneRu(input.phone)
  if (!phone) throw bad('Некорректный номер телефона', 400)
  if (isGuestPhone(phone)) throw bad('Некорректный номер телефона', 400)

  const existing = db
    .prepare('SELECT id, card_id, card_code, cashback_balance, phone, pd_consent_at, pd_consent_version FROM users WHERE phone=?')
    .get(phone) as UserRow | undefined

  if (existing) {
    // Повторная регистрация: обновляем согласие (актуальная версия), карту не пересоздаём.
    if (existing.pd_consent_version !== version || existing.pd_consent_at == null) {
      db.prepare('UPDATE users SET pd_consent_at=?, pd_consent_version=? WHERE id=?').run(Date.now(), version, existing.id)
    }
    return { customer: viewOf(existing), created: false }
  }

  const now = Date.now()
  const nickname = nicknameFromPhone(phone)
  const inviteCode = randomBytes(6).toString('base64url').slice(0, 10).toUpperCase()
  const created = db.transaction(() => {
    const r = db
      .prepare(
        `INSERT INTO users(phone, nickname, invite_code, invited_by, created_at,
                           pd_consent_at, pd_consent_version, phone_bound_at)
         VALUES(?,?,?,NULL,?,?,?,?)`,
      )
      .run(phone, nickname, inviteCode, now, now, version, now)
    const id = Number(r.lastInsertRowid)
    ensureCard(id)
    return id
  })()
  const user = db
    .prepare('SELECT id, card_id, card_code, cashback_balance, phone, pd_consent_at, pd_consent_version FROM users WHERE id=?')
    .get(created) as UserRow
  // В лог — только id и маска: телефон в журнал не пишем.
  log.info('customer registered by phone', { user: created, masked: maskPhone(phone), source: input.source ?? 'device' })
  return { customer: viewOf(user), created: true }
}

/** Движения бонусов для гостя — для истории PWA и админки. */
export type LedgerRow = {
  at: number
  operation: string
  cashbackDeltaKopecks: number
  cupsDelta: number
  freeDelta: number
  source: string
  sourceId: string
}

export function ledgerForUser(userId: number, limit = 50): LedgerRow[] {
  const user = db.prepare('SELECT card_id FROM users WHERE id=?').get(userId) as { card_id: string | null } | undefined
  if (!user?.card_id) return []
  const rows = db
    .prepare(
      `SELECT created_at AS at, operation, cashback_delta AS cb, cups_delta AS cups, free_delta AS free,
              source_type AS source, source_id AS sourceId
         FROM loyalty_ledger WHERE card_id=? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(user.card_id, Math.max(1, Math.min(500, Math.floor(limit)))) as {
    at: number
    operation: string
    cb: number
    cups: number
    free: number
    source: string
    sourceId: string
  }[]
  return rows.map((r) => ({
    at: Number(r.at) < 10_000_000_000 ? Number(r.at) * 1000 : Number(r.at),
    operation: String(r.operation),
    cashbackDeltaKopecks: Number(r.cb) || 0,
    cupsDelta: Number(r.cups) || 0,
    freeDelta: Number(r.free) || 0,
    source: String(r.source),
    sourceId: String(r.sourceId),
  }))
}
