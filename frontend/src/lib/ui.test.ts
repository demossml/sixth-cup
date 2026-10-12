import { describe, expect, it } from 'vitest'
import { cupsWord, drinksWord, pluralRu, progressPhrase } from './plural'
import { formatRub } from './money'
import { fmtClock, syncStatus, STALE_MS } from './syncStatus'

describe('pluralRu', () => {
  it('склоняет стаканы', () => {
    const f = (n: number) => `${n} ${cupsWord(n)}`
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(f)).toEqual([
      '1 стакан', '2 стакана', '4 стакана', '5 стаканов', '11 стаканов', '12 стаканов',
      '14 стаканов', '21 стакан', '22 стакана', '25 стаканов', '101 стакан', '111 стаканов',
    ])
  })
  it('склоняет напитки', () => {
    expect([1, 2, 5].map(drinksWord)).toEqual(['напиток', 'напитка', 'напитков'])
    expect(pluralRu(0, 'a', 'b', 'c')).toBe('c')
  })
})

describe('progressPhrase', () => {
  it('подарок важнее прогресса', () => {
    expect(progressPhrase({ n: 5, left: 3, freeAvailable: 1 })).toBe('Подарок: 1 напиток — скажите бариста')
    expect(progressPhrase({ n: 5, left: 3, freeAvailable: 2 })).toBe('Подарок: 2 напитка — скажите бариста')
  })
  it('ещё N стаканов', () => {
    expect(progressPhrase({ n: 5, left: 4, freeAvailable: 0 })).toBe('Ещё 4 стакана до бесплатного')
    expect(progressPhrase({ n: 5, left: 1, freeAvailable: 0 })).toBe('Ещё 1 стакан до бесплатного')
    expect(progressPhrase({ n: 6, left: 5, freeAvailable: 0 })).toBe('Ещё 5 стаканов до бесплатного')
  })
  it('нулевой остаток', () => {
    expect(progressPhrase({ n: 5, left: 0, freeAvailable: 0 })).toBe('Купите 5 стаканов — следующий в подарок')
  })
})

describe('formatRub (копейки честно)', () => {
  it('показывает копейки только когда они есть', () => {
    expect(formatRub(450)).toBe('4,50')
    expect(formatRub(400)).toBe('4')
    expect(formatRub(5)).toBe('0,05')
    expect(formatRub(123456).replace(/\s/g, ' ')).toBe('1 234,56')
    expect(formatRub(null)).toBe('0')
    expect(formatRub(-10)).toBe('0')
  })
})

describe('syncStatus', () => {
  const now = new Date('2026-10-12T12:00:00').getTime()
  it('нет сети — QR работает, время последних данных', () => {
    const s = syncStatus({ online: false, syncing: false, lastSync: now - 3600_000, now })
    expect(s.kind).toBe('offline')
    expect(s.label).toBe('Нет сети')
    expect(s.detail).toContain('QR работает')
  })
  it('сеть есть, но давно не обновлялось — другой статус', () => {
    const s = syncStatus({ online: true, syncing: false, lastSync: now - STALE_MS - 1, now })
    expect(s.kind).toBe('stale')
  })
  it('свежие данные и «ещё не обновлялось»', () => {
    expect(syncStatus({ online: true, syncing: false, lastSync: now - 1000, now }).kind).toBe('fresh')
    expect(syncStatus({ online: true, syncing: false, lastSync: 0, now }).kind).toBe('never')
    expect(syncStatus({ online: true, syncing: true, lastSync: 0, now }).kind).toBe('syncing')
  })
  it('время: сегодня только часы, иначе с датой', () => {
    expect(fmtClock(new Date('2026-10-12T09:05:00').getTime(), now)).toMatch(/^09:05$/)
    expect(fmtClock(new Date('2026-10-10T09:05:00').getTime(), now)).toContain('09:05')
    expect(fmtClock(new Date('2026-10-10T09:05:00').getTime(), now).length).toBeGreaterThan(5)
  })
})
