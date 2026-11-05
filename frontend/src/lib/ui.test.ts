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
  it('подарок собран — все стаканы на месте', () => {
    expect(progressPhrase({ n: 5, marks: 5, freeAvailable: 1 })).toBe('Все 5 стаканов собраны')
    expect(progressPhrase({ n: 5, marks: 5, freeAvailable: 2 })).toBe('Все 5 стаканов собраны')
  })
  it('ещё N стаканов до подарка', () => {
    expect(progressPhrase({ n: 5, marks: 1, freeAvailable: 0 })).toBe('Ещё 4 стакана до подарка')
    expect(progressPhrase({ n: 5, marks: 4, freeAvailable: 0 })).toBe('Ещё 1 стакан до подарка')
    expect(progressPhrase({ n: 6, marks: 1, freeAvailable: 0 })).toBe('Ещё 5 стаканов до подарка')
    expect(progressPhrase({ n: 5, marks: 3, freeAvailable: 0 })).toBe('Ещё 2 стакана до подарка')
  })
  it('нулевой прогресс — фраза про следующий стакан', () => {
    expect(progressPhrase({ n: 5, marks: 0, freeAvailable: 0 })).toBe('6-й стакан — в подарок')
  })
  it('без подхода к подарку не обещает больше N', () => {
    expect(progressPhrase({ n: 5, marks: 0, freeAvailable: 0 })).not.toContain('до подарка')
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
