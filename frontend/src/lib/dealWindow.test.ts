import { describe, it, expect } from 'vitest'
import { isVisibleAt, minutesOf, windowLabel } from './dealWindow'

const at = (h: number, m = 0) => h * 60 + m

describe('isVisibleAt', () => {
  it('без границ видно всегда', () => {
    expect(isVisibleAt({}, at(0))).toBe(true)
    expect(isVisibleAt({ from: null, to: null }, at(23, 59))).toBe(true)
  })

  it('утреннее окно 06:00–12:00', () => {
    const w = { from: at(6), to: at(12) }
    expect(isVisibleAt(w, at(5, 59))).toBe(false)
    expect(isVisibleAt(w, at(6))).toBe(true)
    expect(isVisibleAt(w, at(11, 59))).toBe(true)
    expect(isVisibleAt(w, at(12))).toBe(false) // конец не включается
  })

  it('обеденное окно 12:00–17:00', () => {
    const w = { from: at(12), to: at(17) }
    expect(isVisibleAt(w, at(11))).toBe(false)
    expect(isVisibleAt(w, at(13))).toBe(true)
    expect(isVisibleAt(w, at(18))).toBe(false)
  })

  it('вечернее окно 17:00–23:00', () => {
    const w = { from: at(17), to: at(23) }
    expect(isVisibleAt(w, at(16, 59))).toBe(false)
    expect(isVisibleAt(w, at(19))).toBe(true)
    expect(isVisibleAt(w, at(23, 30))).toBe(false)
  })

  it('окно через полночь 22:00–02:00', () => {
    const w = { from: at(22), to: at(2) }
    expect(isVisibleAt(w, at(21))).toBe(false)
    expect(isVisibleAt(w, at(23))).toBe(true)
    expect(isVisibleAt(w, at(1))).toBe(true)
    expect(isVisibleAt(w, at(2))).toBe(false)
    expect(isVisibleAt(w, at(12))).toBe(false)
  })

  it('только начало — до конца дня', () => {
    expect(isVisibleAt({ from: at(18) }, at(17, 59))).toBe(false)
    expect(isVisibleAt({ from: at(18) }, at(23, 59))).toBe(true)
  })

  it('только конец — с начала дня', () => {
    expect(isVisibleAt({ to: at(11) }, at(0))).toBe(true)
    expect(isVisibleAt({ to: at(11) }, at(11))).toBe(false)
  })

  it('равные границы — весь день (защита от кривого ввода)', () => {
    expect(isVisibleAt({ from: at(9), to: at(9) }, at(3))).toBe(true)
  })

  it('минуты за пределами суток нормализуются', () => {
    expect(isVisibleAt({ from: at(22), to: at(2) }, at(24) + at(1))).toBe(true)
  })
})

describe('minutesOf', () => {
  it('считает минуты от полуночи', () => {
    expect(minutesOf(new Date(2026, 10, 12, 7, 30))).toBe(at(7, 30))
    expect(minutesOf(new Date(2026, 10, 12, 0, 0))).toBe(0)
  })
})

describe('windowLabel', () => {
  it('пишет окно по-человечески', () => {
    expect(windowLabel({})).toBe('весь день')
    expect(windowLabel({ from: at(6), to: at(12) })).toBe('06:00–12:00')
    expect(windowLabel({ from: at(18) })).toBe('с 18:00')
    expect(windowLabel({ to: at(11) })).toBe('до 11:00')
  })
})
