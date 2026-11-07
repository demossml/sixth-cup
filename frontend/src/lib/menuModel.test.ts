import { describe, expect, it } from 'vitest'
import { buildMenuItems, formatKcal, formatPrice, formatSize, itemsCountLabel, pickPopular, searchItems, storeHours, type MenuDirectory } from './menuModel'

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
  it('«Популярное»: только отмеченные в админке, максимум 4', () => {
    const marked = buildMenuItems(dir({
      products: [
        { id: 1, name: 'Первый', price: 1, icon: 'Coffee', isPopular: true },
        { id: 2, name: 'Второй', price: 1, icon: 'Coffee' },
        { id: 3, name: 'Третий', price: 1, icon: 'Coffee', isPopular: true },
        { id: 4, name: 'Четвёртый', price: 1, icon: 'Coffee', isPopular: true },
        { id: 5, name: 'Пятый', price: 1, icon: 'Coffee', isPopular: true },
        { id: 6, name: 'Шестой', price: 1, icon: 'Coffee', isPopular: true },
      ],
    }))
    expect(pickPopular(marked).map((i) => i.product.id)).toEqual([1, 3, 4, 5])
    expect(pickPopular(items)).toEqual([])
  })

  it('бейдж из админки приоритетнее CMS', () => {
    const list = buildMenuItems(dir({
      products: [{ id: 1, name: 'Раф', price: 1, icon: 'Coffee', badge: 'hit' }],
      content: [{ id: 5, title: 'x', productId: 1, badge: 'new' }],
    }))
    expect(list[0].badge).toBe('new')
    const onlyAdmin = buildMenuItems(dir({ products: [{ id: 1, name: 'Раф', price: 1, icon: 'Coffee', badge: 'seasonal' }] }))
    expect(onlyAdmin[0].badge).toBe('seasonal')
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

describe('storeHours', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 7, h, m)

  it('открыто и закрыто по часам точки', () => {
    expect(storeHours({ openTime: '08:00', closeTime: '21:00' }, at(12))).toEqual({ open: true, label: 'до 21:00' })
    expect(storeHours({ openTime: '08:00', closeTime: '21:00' }, at(22))).toEqual({ open: false, label: '08:00–21:00' })
  })

  it('ночная смена считается открытой', () => {
    expect(storeHours({ openTime: '22:00', closeTime: '06:00' }, at(2)).open).toBe(true)
    expect(storeHours({ openTime: '22:00', closeTime: '06:00' }, at(12)).open).toBe(false)
  })

  it('часы не заданы — точка считается открытой', () => {
    expect(storeHours({}, at(3))).toEqual({ open: true, label: '' })
    expect(storeHours({ openTime: '08:00', closeTime: null }, at(3)).open).toBe(true)
  })
})

describe('itemsCountLabel', () => {
  it('склоняет «позиция/позиции/позиций»', () => {
    expect(itemsCountLabel(1)).toBe('1 позиция')
    expect(itemsCountLabel(3)).toBe('3 позиции')
    expect(itemsCountLabel(8)).toBe('8 позиций')
    expect(itemsCountLabel(11)).toBe('11 позиций')
    expect(itemsCountLabel(21)).toBe('21 позиция')
  })
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

describe('размеры: одна плитка на группу', () => {
  const d = dir({
    products: [
      { id: 1, name: 'Капучино 200 мл', price: 200, icon: 'Coffee', sortOrder: 1, groupId: 9, variantLabel: '200 мл', variantSort: 0, sizeValue: 200, sizeUnit: 'ml' },
      { id: 2, name: 'Капучино 300 мл', price: 300, icon: 'Coffee', sortOrder: 1, groupId: 9, variantLabel: '300 мл', variantSort: 1, sizeValue: 300, sizeUnit: 'ml' },
      { id: 3, name: 'Круассан', price: 120, icon: 'Croissant', sortOrder: 2 },
    ],
    productGroups: [
      { id: 9, name: 'Капучино', imageUrl: '/uploads/cap.jpg', categoryId: 1, description: 'с молоком', variants: [1, 2] },
    ],
  })
  const items = buildMenuItems(d)

  it('две SKU склеиваются в одну плитку с именем и фото группы', () => {
    expect(items.map((i) => i.product.id)).toEqual([1, 3])
    const cap = items[0]
    expect(cap.product.name).toBe('Капучино')
    expect(cap.product.imageUrl).toBe('/uploads/cap.jpg')
    expect(cap.product.description).toBe('с молоком')
  })

  it('цена плитки — минимальная, варианты отсортированы', () => {
    const cap = items[0]
    expect(cap.product.price).toBe(200)
    expect(cap.variants?.map((v) => [v.label, v.price])).toEqual([['200 мл', 200], ['300 мл', 300]])
  })

  it('одиночная позиция без группы остаётся без вариантов', () => {
    expect(items[1].product.name).toBe('Круассан')
    expect(items[1].variants).toBeFalsy()
  })

  it('группа из одного доступного размера не склеивается', () => {
    const one = buildMenuItems(dir({
      products: [{ id: 1, name: 'Капучино 200 мл', price: 200, icon: 'Coffee', groupId: 9 }],
      productGroups: [{ id: 9, name: 'Капучино', imageUrl: null, categoryId: null, description: null, variants: [1] }],
    }))
    expect(one).toHaveLength(1)
    expect(one[0].variants).toBeFalsy()
  })
})
