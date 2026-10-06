import { describe, expect, it } from 'vitest'
import { config } from '../config'
import { cashbackOf, freeEarned } from '../modules/loyalty/rules'

describe('loyalty arithmetic', () => {
  it('makes the sixth cup free after five paid cups', () => {
    expect(config.cupsForFree).toBe(5)
    expect(freeEarned(0)).toBe(0)
    expect(freeEarned(4)).toBe(0)
    expect(freeEarned(5)).toBe(1)
    expect(freeEarned(10)).toBe(2)
    expect(25 % config.cupsForFree).toBe(0)
  })

  it('calculates cashback in the same internal money unit', () => {
    expect(cashbackOf(10_000)).toBe(300)
    expect(cashbackOf(0)).toBe(0)
  })
})
