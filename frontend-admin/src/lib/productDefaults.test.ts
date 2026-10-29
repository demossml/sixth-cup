import { describe, expect, it } from 'vitest'
import { newProductDefaults } from './productDefaults'

describe('newProductDefaults', () => {
  it('напиток по умолчанию — чашка и доступен как подарок', () => {
    const d = newProductDefaults(['a', 'b'])
    expect(d.countsAsCup).toBe(1)
    expect(d.freeEligible).toBe(1)
    expect(d.storeUuids).toEqual(['a', 'b'])
  })

  it('пустые базовые поля', () => {
    const d = newProductDefaults([])
    expect(d).toMatchObject({ name: '', price: 0, available: 1 })
  })
})
