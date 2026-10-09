import { describe, expect, it } from 'vitest'

function productUuid(tx: Record<string, unknown>): string | null {
  const value =
    tx.commodityUuid ??
    tx.commodity_uuid ??
    tx.productUuid ??
    tx.product_uuid ??
    tx.productId ??
    tx.product_id ??
    tx.code
  return typeof value === 'string' && value ? value : null
}

function number(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(',', '.').trim())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

describe('evotor REGISTER_POSITION fields', () => {
  it('reads commodityUuid from live API shape', () => {
    const tx = {
      type: 'REGISTER_POSITION',
      commodityUuid: 'e4e11fb2-68d6-4a20-be08-279dec51e8f6',
      commodityName: 'Американо',
      quantity: 2,
      price: 15000,
      sum: 30000,
    }
    expect(productUuid(tx)).toBe('e4e11fb2-68d6-4a20-be08-279dec51e8f6')
  })

  it('parses closeSum string', () => {
    expect(number('30000.00')).toBe(30000)
    expect(number('200.00')).toBe(200)
  })
})
