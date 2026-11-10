import { describe, expect, it } from 'vitest'
import { typograph } from './typography'

describe('типографика', () => {
  it('не отрывает единицу измерения от числа', () => {
    expect(typograph('Капучино 250 мл')).toBe('Капучино 250\u00A0мл')
    expect(typograph('169 ₽')).toBe('169\u00A0₽')
  })
  it('приклеивает кавычки к слову', () => {
    expect(typograph('« Капучино »')).toBe('«Капучино»')
  })
  it('не оставляет тире в начале строки', () => {
    expect(typograph('Капучино — 169')).toBe('Капучино\u00A0— 169')
  })
  it('пустая строка не ломает рендер', () => {
    expect(typograph(null)).toBe('')
  })
})
