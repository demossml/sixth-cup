import { describe, expect, it } from 'vitest'
import { ageLabel, itemsSummary, newOrderIds, shouldBlink, sortOrders } from './queue'

const order = (over: Partial<{ id: string; status: 'new' | 'seen' | 'done'; createdAt: number; items: { name: string; qty: number; mods: string[]; note: string | null }[] }> = {}) => ({
  id: 'o1',
  status: 'new' as const,
  createdAt: 0,
  items: [],
  ...over,
})

describe('shouldBlink', () => {
  it('моргает только новый заказ и только при включённой настройке', () => {
    expect(shouldBlink(order({ status: 'new' }), true)).toBe(true)
    expect(shouldBlink(order({ status: 'new' }), false)).toBe(false)
    expect(shouldBlink(order({ status: 'seen' }), true)).toBe(false)
    expect(shouldBlink(order({ status: 'done' }), true)).toBe(false)
  })
})

describe('ageLabel', () => {
  const now = 10_000_000
  it('меньше минуты — «только что»', () => {
    expect(ageLabel(now - 5_000, now)).toBe('только что')
  })
  it('минуты и часы', () => {
    expect(ageLabel(now - 3 * 60_000, now)).toBe('3 мин')
    expect(ageLabel(now - 65 * 60_000, now)).toBe('1 ч 5 мин')
    expect(ageLabel(now - 120 * 60_000, now)).toBe('2 ч')
  })
  it('часы на устройстве отстают — не показываем отрицательный возраст', () => {
    expect(ageLabel(now + 60_000, now)).toBe('только что')
  })
})

describe('itemsSummary', () => {
  it('склеивает позиции и модификаторы', () => {
    expect(itemsSummary(order({ items: [
      { name: 'Капучино 350', qty: 2, mods: ['Овсяное', 'Ваниль'], note: null },
      { name: 'Круассан', qty: 1, mods: [], note: 'разогреть' },
    ] }))).toBe('Капучино 350 ×2 (Овсяное, Ваниль) · Круассан ×1')
  })
})

describe('sortOrders', () => {
  it('FIFO: раньше создан — раньше в очереди', () => {
    const sorted = sortOrders([
      { id: 'b', createdAt: 200 },
      { id: 'a', createdAt: 100 },
      { id: 'c', createdAt: 300 },
    ])
    expect(sorted.map((o) => o.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('newOrderIds', () => {
  it('возвращает только появившиеся заказы', () => {
    expect(newOrderIds([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }])).toEqual(['b'])
    expect(newOrderIds([], [{ id: 'a' }])).toEqual(['a'])
    expect(newOrderIds([{ id: 'a' }], [{ id: 'a' }])).toEqual([])
  })
})
