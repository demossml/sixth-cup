import { describe, expect, it } from 'vitest'
import { normalizeCardCode } from '../modules/loyalty/proof'

describe('manual loyalty card codes', () => {
  it('accepts digits and normalizes leading zeroes', () => {
    expect(normalizeCardCode('0042')).toBe('42')
    expect(normalizeCardCode('42')).toBe('42')
    expect(normalizeCardCode('0001')).toBe('1')
  })

  it('rejects non-numeric and oversized input', () => {
    expect(normalizeCardCode('42-1')).toBeNull()
    expect(normalizeCardCode('abc')).toBeNull()
    expect(normalizeCardCode('1'.repeat(19))).toBeNull()
  })
})
