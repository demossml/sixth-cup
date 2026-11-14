import { describe, it, expect, beforeAll } from 'vitest'
import { app } from '../app'
import { config } from '../config'
import { db } from '../db'

/**
 * Регресс аудита 14.11.2026: на «Аналитике» ряд/обзор/теплокарта показывали
 * разные окна (24 ч vs 30 дн), потому что UI слал `??period=…`, а дефолты
 * эндпоинтов не совпадали. Здесь фиксируем и то, и другое.
 */
const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const call = async (p: string) => {
  const r = await app.request(`/api/admin${p}`, { headers: H })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any }
}

const DAY = 86_400_000
const STORE = 'store-analytics-period'

beforeAll(() => {
  // Одна продажа с картой 10 дней назад: попадает в 30 дней, но не в 7.
  db.prepare(
    `INSERT OR REPLACE INTO loyalty_ops (doc_store, doc_id, kind, card_id, free, cb, result_rub, cups_counted, created_at)
     VALUES (?, ?, 'SELL', 'card-period', 0, 0, 190, 1, ?)`,
  ).run(STORE, 'doc-period-10d', Date.now() - 10 * DAY)
})

describe('период аналитики', () => {
  it('без параметра series отдаёт 7 дней (как вкладка по умолчанию)', async () => {
    const r = await call('/analytics/series')
    expect(r.status).toBe(200)
    expect(r.json.period).toBe('7d')
    const span = r.json.until - r.json.since
    expect(Math.abs(span - 7 * DAY)).toBeLessThan(5000)
  })

  it('series c period=7d и без параметра — одно окно', async () => {
    const a = await call('/analytics/series')
    const b = await call('/analytics/series?period=7d')
    expect(b.json.period).toBe('7d')
    expect(Math.abs(a.json.until - b.json.until)).toBeLessThan(5000)
  })

  it('overview без параметра использует то же окно 7 дней', async () => {
    const r = await call('/analytics/overview')
    expect(r.status).toBe(200)
    const span = r.json.period.until - r.json.period.since
    expect(Math.abs(span - 7 * DAY)).toBeLessThan(5000)
  })

  it('by-store без параметра — тоже 7 дней, а не 24 часа', async () => {
    const r = await call('/analytics/by-store')
    expect(r.status).toBe(200)
    expect(r.json.period).toBe('7d')
  })

  it('теплокарта слушает period: 10-дневная продажа видна в 30 днях и не видна в 7', async () => {
    const week = await call('/analytics/heatmap?period=7d&storeUuid=' + STORE)
    const month = await call('/analytics/heatmap?period=30d&storeUuid=' + STORE)
    expect(week.status).toBe(200)
    expect(month.status).toBe(200)
    expect(week.json.total).toBe(0)
    expect(month.json.total).toBe(1)
  })

  it('теплокарта без параметра больше не уезжает в 30 дней', async () => {
    const bare = await call('/analytics/heatmap?storeUuid=' + STORE)
    expect(bare.json.total).toBe(0)
  })
})
