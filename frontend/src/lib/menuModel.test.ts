import { describe, expect, it } from 'vitest'
import { buildMenuItems, formatKcal, formatPrice, formatSize, modifierGroupsFor, pickHighlights, searchItems, type MenuDirectory } from './menuModel'

const base = {
  serverPub: '', cupsForFree: 6, referralCashbackPercent: 0, currency: 'RUB', generatedAt: 1, devices: [], stores: [], promos: [],
} as const

const dir = (over: Partial<MenuDirectory>): MenuDirectory => ({ ...base, products: [], ...over }) as MenuDirectory

describe('buildMenuItems', () => {
  const d = dir({
    products: [
      { id: 1, name: 'Капучино', price: 250, icon: 'Coffee', sortOrder: 2, freeEligible: true },
      { id: 2, name: 'Раф ореховый', price: 320, icon: 'Coffee', sortOrder: 1 },
      { id: 3, name: 'Чизкейк', price: 280, icon: 'Croissant', sortOrder: 3 },
    ],
    content: [
      { id: 10, title: 'a', productId: 1, badge: 'hit' },
      { id: 11, title: 'b', productId: 2, badge: 'new' },
      { id: 12, title: 'c', productId: 3, badge: 'seasonal' },
      { id: 13, title: 'd', productId: null, badge: 'hit' },
    ],
  })
  const items = buildMenuItems(d)
  it('сортирует по sortOrder', () => expect(items.map((i) => i.product.id)).toEqual([2, 1, 3]))
  it('бейдж только из CMS; «подарка» в витрине нет', () => {
    expect(items.find((i) => i.product.id === 1)!.badge).toBe('hit')
    expect(items.find((i) => i.product.id === 2)!.badge).toBe('new')
    expect(items.find((i) => i.product.id === 3)!.badge).toBe('seasonal')
  })
  it('ряд «Стоит попробовать»: новинки раньше хитов, сезон и подарок не попадают', () => {
    expect(pickHighlights(items).map((i) => i.product.id)).toEqual([2, 1])
    expect(pickHighlights(buildMenuItems(dir({ products: d.products })))).toEqual([])
  })
})

describe('searchItems', () => {
  const items = buildMenuItems(dir({
    products: [
      { id: 1, name: 'Ёлочный латте', price: 1, icon: 'Coffee', description: 'с имбирём' },
      { id: 2, name: 'Капучино', price: 1, icon: 'Coffee' },
      { id: 3, name: 'Латте капучино', price: 1, icon: 'Coffee' },
    ],
  }))
  it('игнорирует регистр и ё/е', () => expect(searchItems(items, 'ЕЛОЧНЫЙ').map((i) => i.product.id)).toEqual([1]))
  it('ищет по описанию', () => expect(searchItems(items, 'имбир').map((i) => i.product.id)).toEqual([1]))
  it('совпадение с начала названия — выше', () => expect(searchItems(items, 'капуч').map((i) => i.product.id)).toEqual([2, 3]))
  it('пустой запрос — всё', () => expect(searchItems(items, '  ')).toHaveLength(3))
  it('нет совпадений', () => expect(searchItems(items, 'пицца')).toEqual([]))
})

describe('modifierGroupsFor', () => {
  const d = dir({
    products: [{ id: 1, name: 'Раф', price: 1, icon: 'Coffee', modifierSchemeId: 7 }],
    modifiers: [
      { id: 1, name: 'Орех', price: 40, groupKey: 'syrup', sortOrder: 1 },
      { id: 2, name: 'Овсяное', price: 60, groupKey: 'milk', sortOrder: 2 },
      { id: 3, name: 'Корица', price: 0, groupKey: 'weird', sortOrder: 3 },
    ],
    modifierSchemes: [{ id: 7, name: 's', items: [
      { modifierId: 1, required: false, maxCount: 2 }, { modifierId: 2, required: false, maxCount: 1 },
      { modifierId: 3, required: false, maxCount: 1 }, { modifierId: 99, required: false, maxCount: 1 },
    ] }],
  })
  it('группирует и упорядочивает: молоко, сиропы, другое; неизвестные id пропускает', () => {
    const g = modifierGroupsFor(d, d.products[0])
    expect(g.map((x) => x.key)).toEqual(['milk', 'syrup', 'other'])
    expect(g[1].items[0]).toMatchObject({ name: 'Орех', price: 40, maxCount: 2 })
  })
  it('без схемы — пусто', () => expect(modifierGroupsFor(d, { ...d.products[0], modifierSchemeId: null })).toEqual([]))
})

describe('formatPrice', () => {
  it('ru-RU с ₽', () => expect(formatPrice(1250)).toMatch(/^1\s250\s₽$/))
})

describe('formatSize / formatKcal', () => {
  it('граммы и миллилитры', () => {
    expect(formatSize({ sizeValue: 250, sizeUnit: 'ml' })).toBe('250\u00A0мл')
    expect(formatSize({ sizeValue: 180, sizeUnit: 'g' })).toBe('180\u00A0г')
  })
  it('от 1000 — литры/кило', () => {
    expect(formatSize({ sizeValue: 1500, sizeUnit: 'ml' })).toBe('1,5\u00A0л')
    expect(formatSize({ sizeValue: 1000, sizeUnit: 'g' })).toBe('1\u00A0кг')
  })
  it('не задано — null', () => {
    expect(formatSize({ sizeValue: null, sizeUnit: null })).toBeNull()
    expect(formatSize({ sizeValue: 0, sizeUnit: 'g' })).toBeNull()
    expect(formatKcal({ calories: null })).toBeNull()
  })
  it('ккал', () => expect(formatKcal({ calories: 120 })).toBe('120\u00A0ккал'))
})
