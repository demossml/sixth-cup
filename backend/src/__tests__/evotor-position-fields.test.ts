import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-pos-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

// These tests import the REAL helpers (earlier versions tested local copies of the functions).
const { sellInternals: s } = await import('../integrations/evotor/processing/SellHandler')

const COMMODITY = 'e4e11fb2-68d6-4a20-be08-279dec51e8f6'

describe('evotor REGISTER_POSITION fields', () => {
  it('reads commodityUuid first (live API shape)', () => {
    expect(s.productUuid({ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, productUuid: 'other' })).toBe(COMMODITY)
    expect(s.productUuid({ commodity_uuid: 'c1' })).toBe('c1')
    expect(s.productUuid({ productUuid: 'p1' })).toBe('p1')
    expect(s.productUuid({ product_id: 'p2' })).toBe('p2')
    expect(s.productUuid({ type: 'DISCOUNT' })).toBeNull()
  })

  it('parses numeric strings (closeSum is a string)', () => {
    expect(s.number('30000.00')).toBe(30000)
    expect(s.number('200,50')).toBe(200.5)
    expect(s.number('')).toBe(0)
    expect(s.number('abc')).toBe(0)
    expect(s.number(null)).toBe(0)
    expect(s.number(12)).toBe(12)
  })

  it('document id is uuid, falling back to id', () => {
    expect(s.documentIdOf({ uuid: 'u1', id: 'i1' })).toBe('u1')
    expect(s.documentIdOf({ id: 'i1' })).toBe('i1')
    expect(s.documentIdOf({})).toBeNull()
  })

  it('money scale: unit price >= 1000 means the document is already in kopecks', () => {
    const cloud = [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 2, price: 15000, sum: 30000 }]
    expect(s.amountKopecks({ closeSum: '30000.00' }, cloud)).toBe(30000)
    const physical = [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 2, price: 150, sum: 300 }]
    expect(s.amountKopecks({ closeSum: '300.00' }, physical)).toBe(30000)
    // no closeSum: fall back to position sums
    expect(s.amountKopecks({}, cloud)).toBe(30000)
    expect(s.amountKopecks({}, physical)).toBe(30000)
  })

  it('getSc accepts nested appId and JSON-string sc, rejects v<2', () => {
    const sc = { v: 2, c: '0012', free: 0, cb: 0, ts: 1 }
    const APP = '151071e8-88a4-44f6-b71a-b17c559f9b7d'
    expect(s.getSc({ extras: { [APP]: { sc } } })?.c).toBe('0012')
    expect(s.getSc({ extras: { sc: JSON.stringify(sc) } })?.c).toBe('0012')
    expect(s.getSc({ extras: { sc: { ...sc, v: 1 } } })).toBeNull()
    expect(s.getSc({ extras: {} })).toBeNull()
  })
})
