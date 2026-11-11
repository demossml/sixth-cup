import { describe, it, expect } from 'vitest'
import { greetingFor } from './greeting'

const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m, 0, 0)

describe('greetingFor', () => {
  it('утро с 5:00 до 11:59', () => {
    expect(greetingFor(at(5))).toBe('Доброе утро')
    expect(greetingFor(at(8, 30))).toBe('Доброе утро')
    expect(greetingFor(at(11, 59))).toBe('Доброе утро')
  })

  it('день с 12:00 до 16:59', () => {
    expect(greetingFor(at(12))).toBe('Добрый день')
    expect(greetingFor(at(16, 59))).toBe('Добрый день')
  })

  it('вечер с 17:00 до 22:59', () => {
    expect(greetingFor(at(17))).toBe('Добрый вечер')
    expect(greetingFor(at(22, 59))).toBe('Добрый вечер')
  })

  it('ночь с 23:00 до 4:59', () => {
    expect(greetingFor(at(23))).toBe('Доброй ночи')
    expect(greetingFor(at(0))).toBe('Доброй ночи')
    expect(greetingFor(at(4, 59))).toBe('Доброй ночи')
  })
})
