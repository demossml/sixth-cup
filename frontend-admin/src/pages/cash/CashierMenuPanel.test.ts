import { describe, expect, it } from 'vitest'
import { cashierMenuPatch, cashierMenuUrl, movedTab } from './CashierMenuPanel'

describe('shared cashier menu requests', () => {
  it('reads and writes the common setting when no store is chosen', () => {
    expect(cashierMenuUrl(null)).toBe('/cashier/menu')
    expect(cashierMenuPatch(null, { showAllTab: false })).toEqual({ showAllTab: false })
  })

  it('targets one store when a store is chosen', () => {
    expect(cashierMenuUrl('store-lenina')).toBe('/cashier/menu?storeUuid=store-lenina')
    expect(cashierMenuUrl('a b')).toBe('/cashier/menu?storeUuid=a%20b')
    expect(cashierMenuPatch('store-lenina', { order: ['Кофе'] })).toEqual({
      storeUuid: 'store-lenina',
      order: ['Кофе'],
    })
  })

  it('sends showAllTab in the same PATCH as order and hidden', () => {
    expect(cashierMenuPatch(null, { showAllTab: true })).toEqual({ showAllTab: true })
    expect(cashierMenuPatch('store-lenina', { showAllTab: false, order: ['Кофе'], hiddenGroups: ['Чай'] })).toEqual({
      storeUuid: 'store-lenina',
      showAllTab: false,
      order: ['Кофе'],
      hiddenGroups: ['Чай'],
    })
  })
})

describe('tab reordering', () => {
  it('swaps neighbours and keeps the list untouched', () => {
    const order = ['Кофе', 'Чай', 'Добавки']
    expect(movedTab(order, 0, 1)).toEqual(['Чай', 'Кофе', 'Добавки'])
    expect(movedTab(order, 2, -1)).toEqual(['Кофе', 'Добавки', 'Чай'])
    expect(order).toEqual(['Кофе', 'Чай', 'Добавки'])
  })

  it('does not move past the edges', () => {
    expect(movedTab(['Кофе', 'Чай'], 0, -1)).toBeNull()
    expect(movedTab(['Кофе', 'Чай'], 1, 1)).toBeNull()
    expect(movedTab([], 0, 1)).toBeNull()
    expect(movedTab(['Кофе'], 5, 1)).toBeNull()
  })
})
