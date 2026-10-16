/**
 * Чистая модель экрана «Меню»: бейджи, модификаторы, поиск.
 * Только данные, которые уже отдаёт GET /api/directory — новых полей API не требуется.
 * Всё считается один раз на смену directory (useMemo в MenuPage), а не на каждый ввод.
 */
import type { Directory } from './types'

export type MenuProduct = Directory['products'][number] & {
  modifierSchemeId?: number | null
  /** Вес/объём порции: число + единица ('g' | 'ml'). Задаётся в админке, необязательно. */
  sizeValue?: number | null
  sizeUnit?: 'g' | 'ml' | null
  /** Ккал на порцию, необязательно. */
  calories?: number | null
}

export type MenuModifier = { id: number; name: string; price: number; groupKey: string; sortOrder?: number }
export type MenuScheme = { id: number; name: string; items: { modifierId: number; required: boolean; maxCount: number }[] }

/** Directory + поля, которые backend отдаёт, но которых нет в общем типе (types.ts не трогаем). */
export type MenuDirectory = Omit<Directory, 'products'> & {
  products: MenuProduct[]
  modifiers?: MenuModifier[]
  modifierSchemes?: MenuScheme[]
}

export type BadgeKind = 'new' | 'hit' | 'seasonal'
export const BADGE_LABEL: Record<BadgeKind, string> = {
  new: 'Новинка',
  hit: 'Хит',
  seasonal: 'Сезон',
}
/** Приоритет бейджа: новинка > хит > сезон. Бейджа «в подарке» в витрине нет. */
const BADGE_ORDER: BadgeKind[] = ['new', 'hit', 'seasonal']

export type ModifierGroup = { key: string; label: string; items: { id: number; name: string; price: number; maxCount: number }[] }
const GROUP_LABEL: Record<string, string> = { milk: 'Молоко', syrup: 'Сиропы', topping: 'Добавки', other: 'Другое' }
const GROUP_ORDER = ['milk', 'syrup', 'topping', 'other']

export type MenuItem = {
  product: MenuProduct
  /** Единственный бейдж карточки (или null). */
  badge: BadgeKind | null
  /** Бейдж из CMS (для ряда «Стоит попробовать»). */
  cmsBadge: BadgeKind | null
  /** Нормализованный текст для поиска: имя + описание. */
  haystack: string
  nameNorm: string
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

const rubFmt = new Intl.NumberFormat('ru-RU')
export const formatPrice = (n: number): string => `${rubFmt.format(Math.round(n))} ₽`

/** «180 г», «250 мл»; от 1000 — «1,5 л» / «1 кг». null, если не задано. */
export function formatSize(p: Pick<MenuProduct, 'sizeValue' | 'sizeUnit'>): string | null {
  const v = p.sizeValue
  if (!v || v <= 0 || !p.sizeUnit) return null
  const ml = p.sizeUnit === 'ml'
  if (v >= 1000) return `${(v / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\u00A0${ml ? 'л' : 'кг'}`
  return `${v}\u00A0${ml ? 'мл' : 'г'}`
}

export const formatKcal = (p: Pick<MenuProduct, 'calories'>): string | null =>
  p.calories == null || p.calories < 0 ? null : `${rubFmt.format(Math.round(p.calories))}\u00A0ккал`

/** productId → бейдж из CMS (new/hit/seasonal). При нескольких записях побеждает более приоритетный. */
export function cmsBadgesByProduct(dir: MenuDirectory): Map<number, BadgeKind> {
  const rank = (b: BadgeKind) => BADGE_ORDER.indexOf(b)
  const out = new Map<number, BadgeKind>()
  const rows = dir.content ?? dir.promos ?? []
  for (const r of rows) {
    const pid = r.productId
    if (pid == null) continue
    const raw = r.badge
    if (raw !== 'new' && raw !== 'hit' && raw !== 'seasonal') continue
    const prev = out.get(pid)
    if (!prev || rank(raw) < rank(prev)) out.set(pid, raw)
  }
  return out
}

/** Отсортированный по sortOrder (стабильно, затем id) список позиций с готовыми бейджами и поисковой строкой. */
export function buildMenuItems(dir: MenuDirectory): MenuItem[] {
  const cms = cmsBadgesByProduct(dir)
  return [...dir.products]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map((product) => {
      const cmsBadge = cms.get(product.id) ?? null
      const nameNorm = normalize(product.name)
      return {
        product,
        cmsBadge,
        badge: cmsBadge,
        nameNorm,
        haystack: product.description ? `${nameNorm} ${normalize(product.description)}` : nameNorm,
      }
    })
}

/** Ряд «Стоит попробовать»: только позиции с бейджем «Новинка»/«Хит» из CMS. Нет данных — пустой массив (блок не рисуется). */
export function pickHighlights(items: MenuItem[], limit = 8): MenuItem[] {
  const rank = (i: MenuItem) => (i.cmsBadge === 'new' ? 0 : 1)
  return items
    .filter((i) => i.cmsBadge === 'new' || i.cmsBadge === 'hit')
    .map((i, idx) => ({ i, idx }))
    .sort((a, b) => rank(a.i) - rank(b.i) || a.idx - b.idx)
    .slice(0, limit)
    .map((x) => x.i)
}

/** Поиск по всем словам запроса (И), в имени и описании. Имя совпало — выше. */
export function searchItems(items: MenuItem[], query: string): MenuItem[] {
  const words = normalize(query).split(' ').filter(Boolean)
  if (!words.length) return items
  const hits: { it: MenuItem; score: number }[] = []
  for (const it of items) {
    if (!words.every((w) => it.haystack.includes(w))) continue
    const inName = words.every((w) => it.nameNorm.includes(w))
    const prefix = it.nameNorm.startsWith(words[0]) ? 0 : inName ? 1 : 2
    hits.push({ it, score: prefix })
  }
  // Array.prototype.sort стабилен — внутри одного score порядок каталога сохраняется.
  return hits.sort((a, b) => a.score - b.score).map((h) => h.it)
}

/** Группы модификаторов для read-only блока в sheet. Пусто — блок не рисуется. */
export function modifierGroupsFor(dir: MenuDirectory, product: MenuProduct): ModifierGroup[] {
  const schemeId = product.modifierSchemeId
  if (schemeId == null) return []
  const scheme = dir.modifierSchemes?.find((s) => s.id === schemeId)
  if (!scheme || !dir.modifiers?.length) return []
  const byId = new Map(dir.modifiers.map((m) => [m.id, m]))
  const groups = new Map<string, ModifierGroup>()
  const used: { m: MenuModifier; maxCount: number }[] = []
  for (const it of scheme.items) {
    const m = byId.get(it.modifierId) // недоступные модификаторы backend уже отфильтровал
    if (m) used.push({ m, maxCount: it.maxCount })
  }
  used.sort((a, b) => (a.m.sortOrder ?? 0) - (b.m.sortOrder ?? 0) || a.m.id - b.m.id)
  for (const { m, maxCount } of used) {
    const key = GROUP_LABEL[m.groupKey] ? m.groupKey : 'other'
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { key, label: GROUP_LABEL[key], items: [] }))
    g.items.push({ id: m.id, name: m.name, price: m.price, maxCount })
  }
  return [...groups.values()].sort((a, b) => GROUP_ORDER.indexOf(a.key) - GROUP_ORDER.indexOf(b.key))
}
