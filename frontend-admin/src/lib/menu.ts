import type { Product } from '../api/types'

export type MenuTab = 'all' | 'on' | 'hidden' | 'errors' | 'nogroup'
export type SyncState = 'none' | 'ok' | 'pending' | 'error'

/** Where the product stands on the till: no stores, all pushed, waiting for push, or a push error. */
export function syncState(p: Pick<Product, 'evotorLinks'>): SyncState {
  const links = (p.evotorLinks ?? []).filter((l) => l.enabled !== 0)
  if (!links.length) return 'none'
  if (links.some((l) => l.lastError)) return 'error'
  if (links.some((l) => !l.evotorUuid)) return 'pending'
  return 'ok'
}

export function filterProducts(
  products: Product[],
  f: { tab: MenuTab; q: string; categoryId: number | 'all' },
): Product[] {
  const q = f.q.trim().toLowerCase()
  return products.filter((p) => {
    if (f.tab === 'on' && !p.available) return false
    if (f.tab === 'hidden' && p.available) return false
    if (f.tab === 'errors' && syncState(p) !== 'error') return false
    if (f.tab === 'nogroup' && p.categoryId) return false
    if (f.categoryId !== 'all' && p.categoryId !== f.categoryId) return false
    if (q && !p.name.toLowerCase().includes(q)) return false
    return true
  })
}

export function tabCounts(products: Product[]): Record<MenuTab, number> {
  return {
    all: products.length,
    on: products.filter((p) => p.available).length,
    hidden: products.filter((p) => !p.available).length,
    errors: products.filter((p) => syncState(p) === 'error').length,
    nogroup: products.filter((p) => !p.categoryId).length,
  }
}

export type SortKey = 'order' | 'name' | 'price' | 'category' | 'updated'

export function sortProducts(list: Product[], key: SortKey, dir: 'asc' | 'desc'): Product[] {
  const sign = dir === 'asc' ? 1 : -1
  const val = (p: Product): string | number => {
    switch (key) {
      case 'name': return p.name.toLowerCase()
      case 'price': return p.price
      case 'category': return (p.categoryName ?? '￿').toLowerCase()
      case 'updated': return p.updatedAt ?? 0
      default: return p.sortOrder * 100000 + p.id
    }
  }
  return [...list].sort((a, b) => {
    const x = val(a)
    const y = val(b)
    if (x < y) return -sign
    if (x > y) return sign
    return a.id - b.id
  })
}

/** Human text for one change in a bulk preview. */
export const FIELD_LABEL: Record<string, string> = {
  price: 'Цена', available: 'В продаже', categoryId: 'Группа', countsAsCup: 'Считается чашкой', freeEligible: 'Бесплатная позиция',
}
export function showChangeValue(field: string, v: unknown, categories: { id: number; name: string }[]): string {
  if (typeof v === 'boolean') return v ? 'да' : 'нет'
  if (field === 'categoryId') return v == null ? 'без группы' : categories.find((c) => c.id === v)?.name ?? `#${v}`
  if (field === 'price') return `${v} ₽`
  return String(v ?? '—')
}
