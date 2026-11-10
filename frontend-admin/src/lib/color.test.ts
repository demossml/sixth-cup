import { describe, expect, it } from 'vitest'
import {
  CONTRAST_LABEL,
  contrastRatio,
  contrastVerdict,
  formatColor,
  normalizeHex,
  overWhite,
  parseColor,
  withAlpha,
} from './color'

describe('разбор цвета', () => {
  it('понимает короткий и полный HEX', () => {
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(parseColor('#12AB34')).toEqual({ r: 18, g: 171, b: 52, a: 1 })
    expect(parseColor('12ab34')).toEqual({ r: 18, g: 171, b: 52, a: 1 })
  })

  it('понимает альфу и rgb()', () => {
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.5, 2)
    expect(parseColor('rgba(255, 0, 0, 0.25)')).toEqual({ r: 255, g: 0, b: 0, a: 0.25 })
    expect(parseColor('rgb(1 2 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 })
  })

  it('мусор не превращается в цвет', () => {
    expect(parseColor('красный')).toBeNull()
    expect(parseColor('')).toBeNull()
    expect(normalizeHex('#12')).toBeNull()
  })

  it('форматирование возвращает альфу только когда она не 100 %', () => {
    expect(formatColor({ r: 18, g: 171, b: 52, a: 1 })).toBe('#12AB34')
    expect(formatColor({ r: 0, g: 0, b: 0, a: 0.5 })).toMatch(/^#000000[78][0-9A-F]$/)
  })

  it('withAlpha не ломает оттенок', () => {
    expect(withAlpha('#12AB34', 0.5)).toBe(formatColor({ r: 18, g: 171, b: 52, a: 0.5 }))
  })
})

describe('контраст по WCAG', () => {
  it('чёрный на белом — 21, белый на белом — 1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1)
  })

  it('уровни подписываются по-человечески', () => {
    expect(contrastVerdict(7).level).toBe('AAA')
    expect(contrastVerdict(4.6).level).toBe('AA')
    expect(contrastVerdict(3.2).level).toBe('AA-large')
    expect(contrastVerdict(2).level).toBe('fail')
    expect(CONTRAST_LABEL.fail).toContain('ниже')
  })

  it('полупрозрачный текст считается по видимому цвету', () => {
    // 50 % чёрного на белом читается как #808080 — контраст ниже AA.
    const ratio = contrastRatio('#00000080', '#FFFFFF')
    expect(ratio).toBeLessThan(4.5)
  })
})

describe('полупрозрачный фон на бумаге', () => {
  it('смешивается с белым, а не остаётся прозрачным', () => {
    expect(overWhite('#00000080')).toMatch(/^#[0-9A-F]{6}$/)
    expect(overWhite('#FFFFFF')).toBe('#FFFFFF')
    expect(overWhite('#000000')).toBe('#000000')
  })
})
