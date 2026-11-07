import { describe, expect, it } from 'vitest'
import { banLeftSec, banText, bannerState, etaLeftSec } from './orderBanner'
import type { OrderOut } from './preorderApi'

const NOW = new Date('2026-11-07T10:00:00.000Z').getTime()
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString()

const order = (patch: Partial<OrderOut> = {}): OrderOut => ({
  id: 'o1',
  shortCode: '123456',
  storeId: 1,
  status: 'draft',
  createdAt: iso(-60_000),
  expiresAt: iso(29 * 60_000),
  estimateTotal: 260,
  currency: 'RUB',
  cardId: null,
  items: [],
  serverNow: new Date(NOW).toISOString(),
  ...patch,
})

describe('etaLeftSec', () => {
  it('считает остаток от серверного времени, а не от часов телефона', () => {
    // телефон убежал на час вперёд: без поправки остаток был бы отрицательным
    const o = order({ status: 'cooking', etaReadyAt: iso(4 * 60_000), serverNow: new Date(NOW).toISOString() })
    expect(etaLeftSec(o, NOW + 3600_000)).toBe(240)
  })
  it('нет ETA — нет остатка', () => {
    expect(etaLeftSec(order(), NOW)).toBeNull()
    expect(etaLeftSec(null, NOW)).toBeNull()
  })
  it('после ETA остаток не уходит в минус', () => {
    const o = order({ status: 'cooking', etaReadyAt: iso(-60_000) })
    expect(etaLeftSec(o, NOW)).toBe(0)
  })
})

describe('bannerState', () => {
  it('draft: ждём подтверждения и TTL в минутах/секундах', () => {
    const s = bannerState(order(), NOW)
    expect(s.label).toBe('Ждём подтверждения')
    expect(s.detail).toContain('29:00')
    expect(s.accent).toBe(false)
    expect(s.filled).toBe(1)
  })
  it('accepted: «Принят» + сколько готовим', () => {
    const s = bannerState(order({ status: 'accepted', etaReadyAt: iso(6 * 60_000) }), NOW)
    expect(s.label).toBe('Принят')
    expect(s.detail).toBe('готовим · 6 минут')
    expect(s.filled).toBe(2)
  })
  it('cooking: «Готовится» + остаток, склонение минут', () => {
    expect(bannerState(order({ status: 'cooking', etaReadyAt: iso(60_000) }), NOW).detail).toBe('через 1 минуту')
    expect(bannerState(order({ status: 'cooking', etaReadyAt: iso(3 * 60_000) }), NOW).detail).toBe('через 3 минуты')
    expect(bannerState(order({ status: 'cooking', etaReadyAt: iso(5 * 60_000) }), NOW).detail).toBe('через 5 минут')
  })
  it('cooking без ETA: «уточняем время»', () => {
    expect(bannerState(order({ status: 'cooking' }), NOW).detail).toBe('уточняем время')
  })
  it('ready: акцент и «забирайте»', () => {
    const s = bannerState(order({ status: 'ready' }), NOW)
    expect(s.label).toBe('Готов — забирайте')
    expect(s.detail).toBe('подойдите к кассе')
    expect(s.accent).toBe(true)
    expect(s.filled).toBe(4)
  })
  it('paid: акцент, номер бариста', () => {
    expect(bannerState(order({ status: 'paid' }), NOW)).toMatchObject({ label: 'Оплачен', accent: true, filled: 4 })
  })
})

describe('ban', () => {
  it('остаток бана и человеческий текст', () => {
    const until = new Date(NOW + 2 * 3600_000 + 30 * 60_000).toISOString()
    expect(banLeftSec(until, NOW)).toBe(2 * 3600 + 30 * 60)
    expect(banText(banLeftSec(until, NOW))).toBe('2 ч 30 мин')
    expect(banText(45 * 60)).toBe('45 минут')
    expect(banText(60)).toBe('1 минуту')
  })
  it('истёкший/пустой бан — ноль', () => {
    expect(banLeftSec(new Date(NOW - 1000).toISOString(), NOW)).toBe(0)
    expect(banLeftSec(null, NOW)).toBe(0)
    expect(banText(0)).toBe('')
  })
})
