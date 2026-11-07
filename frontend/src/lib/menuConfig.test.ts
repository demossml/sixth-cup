import { describe, expect, it } from 'vitest'
import {
  bumpAddon,
  initialSelection,
  restoreSelection,
  selectionKey,
  selectionModifiers,
  selectionPrice,
  selectionText,
  toCartLine,
  validateSelection,
  type ProductConfig,
  type Selection,
} from './menuConfig'

const cfg = (over: Partial<ProductConfig> = {}): ProductConfig => ({
  ok: true,
  productId: 10,
  name: 'Капучино',
  description: 'Эспрессо и молочная пенка',
  imageUrl: null,
  priceRub: 260,
  available: true,
  calories: 120,
  proteinG: 6.4,
  fatG: 5.1,
  carbsG: 10.2,
  volumes: [
    { id: 'sku:10', label: '200 мл', sizeValue: 200, sizeUnit: 'ml', priceRub: 260, available: true, isDefault: true, skuProductId: 10 },
    { id: 'sku:11', label: '300 мл', sizeValue: 300, sizeUnit: 'ml', priceRub: 300, available: true, isDefault: false, skuProductId: 11 },
    { id: 'sku:12', label: '400 мл', sizeValue: 400, sizeUnit: 'ml', priceRub: 340, available: false, isDefault: false, skuProductId: 12 },
  ],
  milk: {
    required: true,
    options: [
      { id: 1, label: 'Обычное', priceRub: 0, isDefault: true, available: true },
      { id: 2, label: 'Кокосовое', priceRub: 40, isDefault: false, available: true },
      { id: 3, label: 'Овсяное', priceRub: 40, isDefault: false, available: false },
    ],
  },
  choice: {
    title: 'Корица',
    options: [
      { id: 7, label: 'С корицей', isDefault: false },
      { id: 8, label: 'Без корицы', isDefault: true },
    ],
  },
  addons: [
    {
      key: 'syrup',
      label: 'Сиропы',
      required: false,
      options: [
        { id: 21, name: 'Ваниль', priceRub: 30, maxCount: 2, required: false, isDefault: false, available: true },
        { id: 22, name: 'Карамель', priceRub: 30, maxCount: 2, required: false, isDefault: false, available: false },
      ],
    },
  ],
  ...over,
})

describe('initialSelection', () => {
  it('берёт дефолтный объём, молоко и вариант выбора', () => {
    const sel = initialSelection(cfg())
    expect(sel).toEqual({ volumeId: 'sku:10', milkId: 1, choiceId: 8, addons: {} })
  })

  it('недоступный по умолчанию объём заменяется первым доступным', () => {
    const c = cfg({
      volumes: [
        { id: 'a', label: '200 мл', sizeValue: 200, sizeUnit: 'ml', priceRub: 260, available: false, isDefault: true, skuProductId: 10 },
        { id: 'b', label: '300 мл', sizeValue: 300, sizeUnit: 'ml', priceRub: 300, available: true, isDefault: false, skuProductId: 11 },
      ],
    })
    expect(initialSelection(c).volumeId).toBe('b')
  })

  it('товар без схем: один базовый объём и без молока', () => {
    const c = cfg({
      volumes: [{ id: 'base', label: '', sizeValue: null, sizeUnit: null, priceRub: 190, available: true, isDefault: true, skuProductId: 10 }],
      milk: null,
      choice: null,
      addons: null,
    })
    expect(initialSelection(c)).toMatchObject({ volumeId: 'base', milkId: null, choiceId: null })
  })
})

describe('цена и состав', () => {
  it('объём + молоко + добавки', () => {
    const c = cfg()
    const sel = { ...initialSelection(c), volumeId: 'sku:11', milkId: 2 }
    expect(selectionPrice(c, sel)).toBe(340)
    expect(selectionPrice(c, bumpAddon(c, sel, 21, 1))).toBe(370)
    expect(selectionPrice(c, bumpAddon(c, sel, 21, 2))).toBe(400)
  })

  it('состав как в макете: объём · молоко · выбор · добавки', () => {
    const c = cfg()
    let sel: Selection = { ...initialSelection(c), volumeId: 'sku:11', milkId: 2, choiceId: 7 }
    sel = bumpAddon(c, sel, 21, 1)
    expect(selectionText(c, sel)).toBe('300 мл · Кокосовое · С корицей · Ваниль')
  })

  it('одно молоко в схеме не дублируется в подписи', () => {
    const c = cfg({ milk: { required: true, options: [{ id: 1, label: 'Обычное', priceRub: 0, isDefault: true, available: true }] } })
    const sel = { ...initialSelection(c), volumeId: 'sku:11' }
    expect(selectionText(c, sel)).toBe('300 мл · Без корицы')
  })
})

describe('добавки', () => {
  it('степпер уважает maxCount и недоступность', () => {
    const c = cfg()
    let sel: Selection = initialSelection(c)
    for (let i = 0; i < 5; i += 1) sel = bumpAddon(c, sel, 21, 1)
    expect(sel.addons[21]).toBe(2)
    expect(bumpAddon(c, sel, 22, 1).addons[22]).toBeUndefined()
    sel = bumpAddon(c, sel, 21, -1)
    expect(sel.addons[21]).toBe(1)
    expect(bumpAddon(c, sel, 21, -1).addons[21]).toBeUndefined()
  })
})

describe('проверка выбора', () => {
  it('недоступный объём и выключенное молоко не пропускаются', () => {
    const c = cfg()
    expect(validateSelection(c, { ...initialSelection(c), volumeId: 'sku:12' })).toMatchObject({ ok: false })
    expect(validateSelection(c, { ...initialSelection(c), milkId: 3 })).toMatchObject({ ok: false })
    expect(validateSelection(c, { ...initialSelection(c), milkId: null })).toMatchObject({ ok: false })
  })

  it('доступная комбинация проходит', () => {
    expect(validateSelection(cfg(), initialSelection(cfg())).ok).toBe(true)
  })

  it('товар не в наличии — нельзя заказать', () => {
    expect(validateSelection(cfg({ available: false }), initialSelection(cfg())).ok).toBe(false)
  })
})

describe('строка корзины', () => {
  it('разные конфигурации не схлопываются в одну строку', () => {
    const c = cfg()
    const a = selectionKey(c, initialSelection(c))
    const b = selectionKey(c, bumpAddon(c, initialSelection(c), 21, 1))
    const d = selectionKey(c, { ...initialSelection(c), milkId: 2 })
    expect(new Set([a, b, d]).size).toBe(3)
  })

  it('в заказ уходит SKU объёма, состав и модификаторы', () => {
    const c = cfg()
    let sel: Selection = { ...initialSelection(c), volumeId: 'sku:11', milkId: 2, choiceId: 7 }
    sel = bumpAddon(c, sel, 21, 2)
    const line = toCartLine(c, sel, 2)
    expect(line).toMatchObject({
      productId: '10',
      name: 'Капучино 300 мл',
      quantity: 2,
      volumeId: '11',
      volumeLabel: '300 мл',
      unitPriceEstimate: 400,
      configText: '300 мл · Кокосовое · С корицей · Ваниль ×2',
    })
    expect(selectionModifiers(c, sel)).toEqual([
      { groupKey: 'milk', modifierId: '2', name: 'Кокосовое', price: 40 },
      { groupKey: 'choice', modifierId: '7', name: 'С корицей', price: 0 },
      { groupKey: 'addon', modifierId: '21', name: 'Ваниль', price: 30 },
      { groupKey: 'addon', modifierId: '21', name: 'Ваниль', price: 30 },
    ])
  })

  it('бесплатное молоко не уходит модификатором', () => {
    const c = cfg()
    const sel = { ...initialSelection(c), milkId: 1 }
    expect(selectionModifiers(c, sel).some((m) => m.groupKey === 'milk')).toBe(false)
  })
})

describe('restoreSelection — «Изменить» из корзины', () => {
  const base = cfg()

  it('поднимает объём, молоко, корицу и количество добавок', () => {
    const sel: Selection = { volumeId: 'sku:11', milkId: 2, choiceId: 7, addons: { 21: 2 } }
    const line = toCartLine(base, sel, 3)
    const restored = restoreSelection(base, line)
    expect(restored).toEqual({ volumeId: 'sku:11', milkId: 2, choiceId: 7, addons: { 21: 2 } })
  })

  it('молоко и объём, которых больше нет в схеме, не ломают карточку — берём дефолт', () => {
    const line = toCartLine(base, initialSelection(base), 1)
    const broken = { ...line, volumeId: 'sku:999', modifiers: [{ groupKey: 'milk', modifierId: '777', name: 'Козье' }] }
    const restored = restoreSelection(base, broken)
    expect(restored?.volumeId).toBe(initialSelection(base).volumeId)
    expect(restored?.milkId).toBe(initialSelection(base).milkId)
  })

  it('добавки неизвестной группы игнорируются', () => {
    const line = toCartLine(base, initialSelection(base), 1)
    const broken = { ...line, modifiers: [{ groupKey: 'syrup', modifierId: '1', name: 'X' }] }
    expect(restoreSelection(base, broken)?.addons).toEqual({})
  })
})
