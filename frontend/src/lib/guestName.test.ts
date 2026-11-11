import { describe, expect, it } from 'vitest'

import { displayNickname } from './guestName'

describe('displayNickname', () => {
  it('скрывает случайный код у гостя', () => {
    expect(displayNickname('Гость I7WFJD')).toBe('Гость')
    expect(displayNickname('гость ab12cd')).toBe('Гость')
    expect(displayNickname('Гость')).toBe('Гость')
  })

  it('настоящее имя оставляет как есть', () => {
    expect(displayNickname('Анна')).toBe('Анна')
    expect(displayNickname('Гостьев Иван')).toBe('Гостьев Иван')
  })

  it('пустое значение — тоже «Гость»', () => {
    expect(displayNickname('')).toBe('Гость')
    expect(displayNickname(null)).toBe('Гость')
    expect(displayNickname(undefined)).toBe('Гость')
  })
})
