import { describe, expect, it } from 'vitest'
import { analyticsPath, periodLabel } from './analyticsQuery'
import { qs } from './query'

describe('qs()', () => {
  it('возвращает строку с ведущим ?', () => {
    expect(qs({ period: '7d' })).toBe('?period=7d')
  })
  it('пустые параметры не попадают в строку', () => {
    expect(qs({ period: '7d', storeUuid: undefined, x: null, y: '' })).toBe('?period=7d')
  })
  it('без параметров — пустая строка', () => {
    expect(qs({})).toBe('')
  })
})

describe('analyticsPath()', () => {
  // Регресс аудита 14.11.2026: `/analytics/series??period=7d` — сервер не видел
  // period, и блоки «Аналитики» жили в разных периодах (24 ч vs 30 дн).
  it('ровно один «?» в адресе', () => {
    const path = analyticsPath('/analytics/series', { period: '7d' })
    expect(path).toBe('/analytics/series?period=7d')
    expect(path.split('?').length - 1).toBe(1)
  })

  it('period доходит до сервера для всех блоков экрана', () => {
    for (const endpoint of ['/analytics/series', '/analytics/by-store', '/analytics/overview', '/analytics/heatmap'] as const) {
      const url = new URL('https://admin.test' + analyticsPath(endpoint, { period: '30d' }))
      expect(url.pathname).toBe(endpoint)
      expect(url.searchParams.get('period')).toBe('30d')
      expect(url.searchParams.has('?period')).toBe(false)
    }
  })

  it('точка передаётся вместе с периодом', () => {
    const url = new URL('https://admin.test' + analyticsPath('/analytics/overview', { period: '7d', storeUuid: 'store-1' }))
    expect(url.searchParams.get('period')).toBe('7d')
    expect(url.searchParams.get('storeUuid')).toBe('store-1')
  })

  it('без параметров адрес без хвоста', () => {
    expect(analyticsPath('/analytics/overview')).toBe('/analytics/overview')
  })
})

describe('periodLabel()', () => {
  it('человеческие подписи периодов', () => {
    expect(periodLabel('7d')).toBe('за 7 дней')
    expect(periodLabel('30d')).toBe('за 30 дней')
    expect(periodLabel('24h')).toBe('за 24 часа')
    expect(periodLabel(undefined)).toBe('')
  })
})
