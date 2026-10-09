import { describe, expect, it } from 'vitest'
import { extractScRaw, hasLoyaltySc } from '../integrations/evotor/loyaltyExtras'

const APP = '151071e8-88a4-44f6-b71a-b17c559f9b7d'
const sample = { v: 2, c: '0012', free: 0, cb: 0, ts: 1791534011 }

describe('loyaltyExtras extractScRaw', () => {
  it('reads flat extras.sc', () => {
    expect(extractScRaw({ sc: sample })).toEqual(sample)
    expect(hasLoyaltySc({ sc: sample })).toBe(true)
  })

  it('reads nested extras[appId].sc (Evotor Cloud shape)', () => {
    const extras = { [APP]: { sc: sample } }
    expect(extractScRaw(extras)).toEqual(sample)
    expect(hasLoyaltySc(extras)).toBe(true)
  })

  it('returns null when empty', () => {
    expect(extractScRaw({})).toBeNull()
    expect(hasLoyaltySc({})).toBe(false)
    expect(extractScRaw(null)).toBeNull()
  })

  it('accepts sc as JSON string', () => {
    expect(extractScRaw({ sc: JSON.stringify(sample) })).toBe(JSON.stringify(sample))
  })
})
