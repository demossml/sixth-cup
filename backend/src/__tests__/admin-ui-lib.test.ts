import { describe, expect, it } from 'vitest'
import { filterProducts, sortProducts, syncState, tabCounts } from '../../../frontend-admin/src/lib/menu'
import { fmtKop, fmtNum, ago } from '../../../frontend-admin/src/lib/format'
import { qs, setParams } from '../../../frontend-admin/src/lib/query'

const p = (o: Record<string, unknown>) => ({ id: 1, name: 'Капучино', price: 200, available: 1, categoryId: 1, categoryName: 'Кофе', sortOrder: 0, updatedAt: 1, evotorLinks: [], ...o }) as any

describe('admin ui lib', () => {
  it('syncState', () => {
    expect(syncState(p({}))).toBe('none')
    expect(syncState(p({ evotorLinks: [{ storeUuid: 's', evotorUuid: 'e' }] }))).toBe('ok')
    expect(syncState(p({ evotorLinks: [{ storeUuid: 's', evotorUuid: null }] }))).toBe('pending')
    expect(syncState(p({ evotorLinks: [{ storeUuid: 's', evotorUuid: 'e', lastError: 'x' }] }))).toBe('error')
    expect(syncState(p({ evotorLinks: [{ storeUuid: 's', evotorUuid: null, enabled: 0 }] }))).toBe('none')
  })
  it('filter and counts', () => {
    const list = [p({ id: 1 }), p({ id: 2, name: 'Чай', available: 0, categoryId: null })]
    expect(filterProducts(list, { tab: 'hidden', q: '', categoryId: 'all' }).map((x) => x.id)).toEqual([2])
    expect(filterProducts(list, { tab: 'all', q: 'кап', categoryId: 'all' }).map((x) => x.id)).toEqual([1])
    expect(filterProducts(list, { tab: 'nogroup', q: '', categoryId: 'all' }).map((x) => x.id)).toEqual([2])
    expect(tabCounts(list)).toMatchObject({ all: 2, on: 1, hidden: 1, nogroup: 1 })
  })
  it('sort is stable and directional', () => {
    const list = [p({ id: 1, price: 300 }), p({ id: 2, price: 100 }), p({ id: 3, price: 100 })]
    expect(sortProducts(list, 'price', 'asc').map((x) => x.id)).toEqual([2, 3, 1])
    expect(sortProducts(list, 'price', 'desc').map((x) => x.id)).toEqual([1, 2, 3])
  })
  it('formatting', () => {
    expect(fmtKop(450)).toBe('4,50')
    expect(fmtKop(100000).replace(/\s/g, ' ')).toBe('1 000')
    expect(fmtNum(null)).toBe('—')
    expect(ago(null)).toBe('никогда')
    expect(ago(1_000_000 - 5 * 60_000, 1_000_000)).toBe('5 мин назад')
  })
  it('query helpers', () => {
    expect(qs({ a: 1, b: '', c: null, d: false, e: 'x y' })).toBe('?a=1&e=x+y')
    expect(setParams(new URLSearchParams('a=1&b=2'), { a: null, c: 3 }).toString()).toBe('b=2&c=3')
  })
})
