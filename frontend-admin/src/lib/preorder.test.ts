import { describe, expect, it } from 'vitest'
import { banText, etaLabel, etaLeftSec, etaText, nextActions, statusLabel, statusTone } from './preorder'

describe('статусы предзаказа', () => {
  it('подписи и тона для всех статусов', () => {
    for (const s of ['draft', 'accepted', 'cooking', 'ready', 'paid', 'cancelled', 'rejected', 'expired']) {
      expect(statusLabel(s).length).toBeGreaterThan(2)
      expect(['neutral', 'ok', 'warn', 'bad']).toContain(statusTone(s))
    }
    expect(statusLabel('unknown')).toBe('unknown')
  })

  it('кнопки ровно те, что разрешает backend', () => {
    expect(nextActions('draft')).toEqual([{ value: 'accepted', label: 'Принять' }])
    expect(nextActions('accepted').map((a) => a.value)).toEqual(['cooking', 'ready'])
    expect(nextActions('cooking').map((a) => a.value)).toEqual(['ready'])
    expect(nextActions('ready')).toEqual([])
    expect(nextActions('paid')).toEqual([])
  })
})

describe('ETA и баны', () => {
  it('остаток считается от серверного времени', () => {
    const now = 1_800_000_000
    expect(etaLeftSec(now + 240, now)).toBe(240)
    expect(etaLeftSec(now - 30, now)).toBe(0)
    expect(etaLeftSec(null, now)).toBeNull()
    expect(etaText(now + 240, now)).toBe('~4 мин')
    expect(etaText(now - 5, now)).toBe('вот-вот')
    expect(etaText(null, now)).toBe('—')
  })

  it('подпись ETA зависит от статуса: без отсчёта у готового и оплаченного', () => {
    const now = 1_800_000_000
    expect(etaLabel('accepted', now + 240, now)).toBe('~4 мин')
    expect(etaLabel('cooking', now + 240, now)).toBe('~4 мин')
    expect(etaLabel('ready', now + 240, now)).toBe('готов, ждём гостя')
    expect(etaLabel('paid', now + 240, now)).toBe('ждём гостя')
    expect(etaLabel('draft', null, now)).toBe('—')
    expect(etaLabel('expired', null, now)).toBe('—')
  })

  it('бан: текст и до какого числа', () => {
    const now = 1_800_000_000
    expect(banText(now + 3600 * 2 + 1800, now)).toBe('2 ч 30 мин')
    expect(banText(now + 59, now)).toBe('1 мин')
    expect(banText(now - 1, now)).toBe('истёк')
    expect(banText(null)).toBe('—')
  })
})
