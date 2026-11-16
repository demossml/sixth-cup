/**
 * Настройки бонусной лояльности (вариант B).
 *
 * Проценты храним в basis points (bps): 500 = 5.00 %. Деньги — копейки, поэтому bps
 * позволяют считать кэшбэк целочисленно: `floor(base * bps / 10000)`.
 *
 * Приоритет: индивидуальный `users.bonus_percent_bps`, иначе глобальный из
 * `loyalty_settings.earn_percent_bps` (одна строка id=1).
 */
import type Database from 'better-sqlite3'
import { db as defaultDb } from '../../db'

type Conn = Pick<Database.Database, 'prepare'>

export const DEFAULT_EARN_BPS = 500
export const MAX_EARN_PERCENT = 100

/** Глобальный процент начисления в bps. Битые/отсутствующие данные → дефолт 5 %. */
export function getGlobalEarnBps(conn: Conn = defaultDb): number {
  try {
    const row = conn.prepare('SELECT earn_percent_bps AS bps FROM loyalty_settings WHERE id=1').get() as
      | { bps: number | null }
      | undefined
    const bps = Number(row?.bps)
    if (!Number.isFinite(bps) || bps < 0) return DEFAULT_EARN_BPS
    return Math.min(bps, MAX_EARN_PERCENT * 100)
  } catch {
    // Старая БД без миграции 071 — работаем на дефолте, а не падаем.
    return DEFAULT_EARN_BPS
  }
}

/** Процент начисления для гостя: индивидуальный важнее глобального. */
export function effectiveEarnBps(conn: Conn, userId: number | null | undefined): number {
  if (userId == null) return getGlobalEarnBps(conn)
  try {
    const row = conn.prepare('SELECT bonus_percent_bps AS bps FROM users WHERE id=?').get(userId) as
      | { bps: number | null }
      | undefined
    const bps = Number(row?.bps)
    // NULL/пусто → наследуем глобальный.
    if (row == null || row.bps == null || !Number.isFinite(bps) || bps < 0) return getGlobalEarnBps(conn)
    return Math.min(bps, MAX_EARN_PERCENT * 100)
  } catch {
    return getGlobalEarnBps(conn)
  }
}

/** Источник процента — чтобы админка и касса показывали, откуда взялась цифра. */
export function earnSourceOf(conn: Conn, userId: number | null | undefined): 'individual' | 'global' {
  if (userId == null) return 'global'
  try {
    const row = conn.prepare('SELECT bonus_percent_bps AS bps FROM users WHERE id=?').get(userId) as
      | { bps: number | null }
      | undefined
    return row?.bps == null ? 'global' : 'individual'
  } catch {
    return 'global'
  }
}

/** Проценты (число, как в UI) из bps: 500 → 5. */
export const bpsToPercent = (bps: number): number => Math.round(bps) / 100

/** Проценты из UI → bps: 5 → 500, 7.25 → 725. Невалидное → null. */
export function percentToBps(percent: unknown): number | null {
  const n = Number(percent)
  if (!Number.isFinite(n) || n < 0 || n > MAX_EARN_PERCENT) return null
  return Math.round(n * 100)
}

/** Кэшбэк в копейках от базы в копейках. Округление — вниз (не начислять больше, чем есть). */
export function earnKopecks(baseKopecks: number, bps: number): number {
  const base = Math.max(0, Math.floor(Number(baseKopecks) || 0))
  const rate = Math.max(0, Math.floor(Number(bps) || 0))
  if (!base || !rate) return 0
  return Math.floor((base * rate) / 10_000)
}

export function setGlobalEarnBps(conn: Conn, bps: number, updatedBy?: string | null): number {
  const value = Math.max(0, Math.min(Math.floor(bps), MAX_EARN_PERCENT * 100))
  conn
    .prepare(
      `INSERT INTO loyalty_settings(id, earn_percent_bps, updated_at, updated_by) VALUES(1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET earn_percent_bps=excluded.earn_percent_bps,
         updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
    )
    .run(value, Date.now(), updatedBy ?? null)
  return value
}

/** Индивидуальный процент: `null` — сбросить к глобальному. Пишет аудит. */
export function setUserBonusBps(
  conn: Conn,
  userId: number,
  bps: number | null,
  admin?: string | null,
): { oldBps: number | null; newBps: number | null } {
  const row = conn.prepare('SELECT bonus_percent_bps AS bps FROM users WHERE id=?').get(userId) as
    | { bps: number | null }
    | undefined
  const oldBps = row?.bps == null ? null : Number(row.bps)
  const next = bps == null ? null : Math.max(0, Math.min(Math.floor(bps), MAX_EARN_PERCENT * 100))
  conn.prepare('UPDATE users SET bonus_percent_bps=? WHERE id=?').run(next, userId)
  try {
    conn
      .prepare('INSERT INTO bonus_percent_audit(user_id, old_bps, new_bps, at, admin) VALUES(?,?,?,?,?)')
      .run(userId, oldBps, next, Date.now(), admin ?? null)
  } catch {
    /* таблицы аудита может не быть в старой БД — настройка важнее журнала */
  }
  return { oldBps, newBps: next }
}
