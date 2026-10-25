import { describe, expect, it } from 'vitest'
import { normalizeCardCode } from '../modules/loyalty/proof'

describe('manual loyalty card codes', () => {
  it('accepts digits and normalizes leading zeroes', () => {
    expect(normalizeCardCode('0042')).toBe('42')
    expect(normalizeCardCode('42')).toBe('42')
    expect(normalizeCardCode('0001')).toBe('1')
  })

  it('accepts the number exactly as the guest sees it (groups of four)', () => {
    // formatCardCode в PWA: код 12345 показывается как «1 2345» (пробел каждые 4 цифры)
    expect(normalizeCardCode('1 2345')).toBe('12345')
    expect(normalizeCardCode('1234 5678')).toBe('12345678')
    expect(normalizeCardCode('\u00a01234\u00a05678')).toBe('12345678')
    expect(normalizeCardCode('0123 4567')).toBe('1234567')
  })

  it('tolerates a typographic dash from printed cards', () => {
    expect(normalizeCardCode('42-1')).toBe('421')
    expect(normalizeCardCode('1234–5678')).toBe('12345678')
  })

  it('rejects non-numeric and oversized input', () => {
    expect(normalizeCardCode('abc')).toBeNull()
    expect(normalizeCardCode('1234 56ab')).toBeNull()
    expect(normalizeCardCode('1'.repeat(19))).toBeNull()
    expect(normalizeCardCode('   ')).toBeNull()
  })
})
