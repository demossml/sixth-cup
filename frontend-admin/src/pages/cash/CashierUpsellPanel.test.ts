import { describe, expect, it } from 'vitest'
import { addUpsell, cashierUpsellUrl, movedUpsell, upsellSearch, type UpsellProduct } from './CashierUpsellPanel'

const products: UpsellProduct[] = [
  { id: 1, name: 'Круассан', price: 120 },
  { id: 2, name: 'Эклер', price: 150 },
  { id: 3, name: 'Сырники', price: 190 },
]

describe('адреса настроек рекомендаций', () => {
  it('с точкой — её настройка, без точки — общая', () => {
    expect(cashierUpsellUrl(null)).toBe('/cashier/upsell')
    expect(cashierUpsellUrl('store-lenina')).toBe('/cashier/upsell?storeUuid=store-lenina')
    expect(cashierUpsellUrl('a b')).toBe('/cashier/upsell?storeUuid=a%20b')
  })
})

describe('порядок рекомендаций', () => {
  it('меняет соседей и не портит исходный список', () => {
    const ids = [1, 2, 3]
    expect(movedUpsell(ids, 0, 1)).toEqual([2, 1, 3])
    expect(movedUpsell(ids, 2, -1)).toEqual([1, 3, 2])
    expect(ids).toEqual([1, 2, 3])
  })

  it('не двигает за границы списка', () => {
    expect(movedUpsell([1, 2], 0, -1)).toBeNull()
    expect(movedUpsell([1, 2], 1, 1)).toBeNull()
    expect(movedUpsell([], 0, 1)).toBeNull()
  })
})

describe('добавление в список', () => {
  it('ставит товар в конец и не дублирует', () => {
    expect(addUpsell([1], 2, 12)).toEqual([1, 2])
    expect(addUpsell([1, 2], 2, 12)).toEqual([1, 2])
  })

  it('не превышает потолок', () => {
    expect(addUpsell([1, 2], 3, 2)).toEqual([1, 2])
  })
})

describe('поиск товара для рекомендаций', () => {
  it('прячет уже выбранные и фильтрует по подстроке', () => {
    expect(upsellSearch(products, [1], '').map((p) => p.id)).toEqual([2, 3])
    expect(upsellSearch(products, [], 'экл').map((p) => p.id)).toEqual([2])
    expect(upsellSearch(products, [], 'ЭКЛЕР').map((p) => p.id)).toEqual([2])
    expect(upsellSearch(products, [], 'нет такого')).toEqual([])
  })
})
