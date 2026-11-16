/**
 * Глобальный и индивидуальный процент кэшбэка (BONUS-LOYALTY, вариант B).
 * Проверяем приоритет: individual → global → сброс к global.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-bonus-settings-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const {
  DEFAULT_EARN_BPS,
  earnKopecks,
  effectiveEarnBps,
  earnSourceOf,
  getGlobalEarnBps,
  percentToBps,
  bpsToPercent,
  setGlobalEarnBps,
  setUserBonusBps,
} = await import('../modules/loyalty/settings')

function mkUser(): number {
  const r = db
    .prepare('INSERT INTO users(phone,nickname,invite_code,created_at) VALUES(?,?,?,?)')
    .run(`guest:${Math.random().toString(16).slice(2)}`, 'Гость TEST', `INV${Math.random().toString(36).slice(2, 8)}`, Date.now())
  return Number(r.lastInsertRowid)
}

beforeEach(() => {
  // глобальный — 5 % по умолчанию из миграции 071
  setGlobalEarnBps(db, DEFAULT_EARN_BPS, 'test')
})

describe('loyalty settings', () => {
  it('по умолчанию глобальный процент = 5 % (500 bps)', () => {
    expect(getGlobalEarnBps(db)).toBe(500)
    expect(bpsToPercent(getGlobalEarnBps(db))).toBe(5)
  })

  it('без индивидуального процента effective = global', () => {
    const userId = mkUser()
    expect(effectiveEarnBps(db, userId)).toBe(500)
    expect(earnSourceOf(db, userId)).toBe('global')
  })

  it('индивидуальный процент перекрывает глобальный', () => {
    const userId = mkUser()
    setGlobalEarnBps(db, 300, 'test')
    setUserBonusBps(db, userId, 700, 'test')
    expect(effectiveEarnBps(db, userId)).toBe(700)
    expect(earnSourceOf(db, userId)).toBe('individual')
  })

  it('сброс индивидуального возвращает глобальный', () => {
    const userId = mkUser()
    setGlobalEarnBps(db, 300, 'test')
    setUserBonusBps(db, userId, 700, 'test')
    const res = setUserBonusBps(db, userId, null, 'test')
    expect(res.oldBps).toBe(700)
    expect(res.newBps).toBeNull()
    expect(effectiveEarnBps(db, userId)).toBe(300)
    expect(earnSourceOf(db, userId)).toBe('global')
  })

  it('изменение индивидуального процента пишется в аудит', () => {
    const userId = mkUser()
    setUserBonusBps(db, userId, 250, 'admin')
    const rows = db.prepare('SELECT old_bps, new_bps, admin FROM bonus_percent_audit WHERE user_id=?').all(userId) as
      { old_bps: number | null; new_bps: number | null; admin: string | null }[]
    expect(rows.at(-1)).toEqual({ old_bps: null, new_bps: 250, admin: 'admin' })
  })

  it('проценты ↔ bps и начисление считаются целочисленно', () => {
    expect(percentToBps(5)).toBe(500)
    expect(percentToBps(7.25)).toBe(725)
    expect(percentToBps(-1)).toBeNull()
    expect(percentToBps(101)).toBeNull()
    // 1000 ₽ при 5 % → 50 ₽ (5000 копеек)
    expect(earnKopecks(100_000, 500)).toBe(5_000)
    // округление вниз: 199 копеек при 5 % → 9 копеек
    expect(earnKopecks(199, 500)).toBe(9)
    expect(earnKopecks(0, 500)).toBe(0)
  })

  it('глобальный процент не выходит за 0..100 %', () => {
    expect(setGlobalEarnBps(db, 25_000, 'test')).toBe(10_000)
    expect(getGlobalEarnBps(db)).toBe(10_000)
  })
})
