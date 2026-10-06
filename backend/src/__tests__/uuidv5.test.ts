import { describe, expect, it } from 'vitest'
import { uuidv5 } from '../integrations/evotor/sync/ProductPushService'

describe('Evotor product UUIDv5', () => {
  it('is deterministic', () => {
    const a = uuidv5('store-1:42')
    const b = uuidv5('store-1:42')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('changes when store or product changes', () => {
    expect(uuidv5('store-1:42')).not.toBe(uuidv5('store-1:43'))
    expect(uuidv5('store-1:42')).not.toBe(uuidv5('store-2:42'))
  })
})
