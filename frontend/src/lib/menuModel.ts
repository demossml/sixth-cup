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
  /** КБЖУ на порцию, граммы — плитки на карточке товара. */
  proteinG?: number | null
  fatG?: number | null
  carbsG?: number | null
  /** Блок «Популярное» на экране меню. */
  isPopular?: boolean
  /** Бейдж карточки из админки (приоритетнее CMS). */
  badge?: BadgeKind | null
  /** Есть выбор объёма (схема или группа) — на карточке «от N ₽». */
  hasVolumes?: boolean
  /** Минимальная цена объёма для «от N ₽». */
  priceFrom?: number
  /** Нет в наличии (стоп-лист точки или снят с продажи). */
  soldOut?: boolean
  mediaType?: 'image' | 'video'
  videoUrl?: string | null
  posterUrl?: string | null
  /** Размеры: id витринной карточки и метка варианта («200 мл»). null — обычная одиночная позиция. */
  groupId?: number | null
  variantLabel?: string | null
  variantSort?: number | null
}

/** Размер внутри карточки: своя цена, свой productId (на кассе — отдельная позиция). */
export type MenuVariant = {
  productId: number
  label: string
  price: number
  sizeValue?: number | null
  sizeUnit?: 'g' | 'ml' | null
}

/** Витринная группа из GET /api/directory: одна карточка, внутри id SKU-вариантов. */
export type MenuGroup = {
  id: number
  name: string
  imageUrl: string | null
  categoryId: number | null
  description: string | null
  sortOrder?: number
  variants: number[]
}

export type MenuModifier = { id: number; name: string; price: number; groupKey: string; sortOrder?: number }
export type MenuScheme = { id: number; name: string; items: { modifierId: number; required: boolean; maxCount: number }[] }

/** Directory + поля, которые backend отдаёт, но которых нет в общем типе (types.ts не трогаем). */
export type MenuDirectory = Omit<Directory, 'products'> & {
  products: MenuProduct[]
  modifiers?: MenuModifier[]
  modifierSchemes?: MenuScheme[]
  productGroups?: MenuGroup[]
}

export type BadgeKind = 'new' | 'hit' | 'seasonal'
export const BADGE_LABEL: Record<BadgeKind, string> = {
  new: 'Новинка',
  hit: 'Хит',
  seasonal: 'Сезон',
}
/** Приоритет бейджа: новинка > хит > сезон. Бейджа «в подарке» в витрине нет. */
const BADGE_ORDER: BadgeKind[] = ['new', 'hit', 'seasonal']


export type MenuItem = {
  product: MenuProduct
  /** Единственный бейдж карточки (или null). */
  badge: BadgeKind | null
  /** Бейдж из CMS (для ряда «Стоит попробовать»). */
  cmsBadge: BadgeKind | null
  /** Нормализованный текст для поиска: имя + описание. */
  haystack: string
  nameNorm: string
  /** Размеры карточки (2+). null/undefined — обычная позиция без выбора объёма. */
  variants?: MenuVariant[] | null
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
  const byId = new Map(dir.products.map((p) => [p.id, p]))
  const consumed = new Set<number>()
  const entries: { item: MenuItem; order: number; id: number }[] = []

  const mkItem = (product: MenuProduct, variants: MenuVariant[] | null, ids: number[]): void => {
    const cmsBadge =
      ids.map((id) => cms.get(id)).find((b): b is BadgeKind => !!b) ??
      (product.badge === 'new' || product.badge === 'hit' || product.badge === 'seasonal' ? product.badge : null)
    const nameNorm = normalize(product.name)
    entries.push({
      item: {
        product,
        variants,
        cmsBadge,
        badge: cmsBadge,
        nameNorm,
        haystack: product.description ? `${nameNorm} ${normalize(product.description)}` : nameNorm,
      },
      order: product.sortOrder ?? 0,
      id: product.id,
    })
  }

  // Карточка с размерами: одна плитка на группу, варианты — внутри (2+ размера, иначе обычная позиция).
  for (const g of dir.productGroups ?? []) {
    const members = (g.variants ?? [])
      .map((id) => byId.get(id))
      .filter((p): p is MenuProduct => !!p)
      .sort((a, b) => (a.variantSort ?? 0) - (b.variantSort ?? 0) || a.id - b.id)
    if (members.length < 2) continue
    const rep = members[0]
    for (const m of members) consumed.add(m.id)
    const variants: MenuVariant[] = members.map((p) => ({
      productId: p.id,
      label: p.variantLabel || formatSize(p) || '',
      price: p.price,
      sizeValue: p.sizeValue ?? null,
      sizeUnit: p.sizeUnit ?? null,
    }))
    mkItem(
      {
        ...rep,
        name: g.name || rep.name,
        imageUrl: g.imageUrl ?? rep.imageUrl,
        description: g.description ?? rep.description,
        categoryId: g.categoryId ?? rep.categoryId,
        price: Math.min(...members.map((m) => m.price)),
      },
      variants,
      members.map((m) => m.id),
    )
  }

  for (const product of dir.products) {
    if (consumed.has(product.id)) continue
    mkItem(product, null, [product.id])
  }

  return entries
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .map((e) => e.item)
}

/**
 * Блок «Популярное»: позиции, отмеченные в админке («Показывать в „Популярном"»).
 * Нет отметок — блок не рисуется (никаких догадок «топ по продажам»).
 */
export function pickPopular(items: MenuItem[], limit = 4): MenuItem[] {
  return items.filter((i) => i.product.isPopular === true).slice(0, limit)
}

/** «8 позиций» рядом с заголовком: количество карточек в каталоге. */
export function itemsCountLabel(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  const word = mod10 === 1 && mod100 !== 11 ? 'позиция' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'позиции' : 'позиций'
  return `${n} ${word}`
}

const minutesOf = (hhmm: string): number | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export type StoreHours = { open: boolean; label: string }

/**
 * Открыта ли точка сейчас и что показать гостю: «Открыто · до 21:00» / «Закрыто · 08:00–21:00».
 * Часы не заданы — считаем открытой (админка их ещё не заполнила).
 */
export function storeHours(
  store: {
    openTime?: string | null
    closeTime?: string | null
    hours?: ({ open: string; close: string } | null)[] | null
  },
  now = new Date(),
): StoreHours {
  const fmt = (s: string | null | undefined) => (s ?? '').slice(0, 5)
  // Часы по дням важнее общей пары: в выходной день точка закрыта целиком.
  const week = store.hours && store.hours.length === 7 ? store.hours : null
  if (week) {
    const dayIdx = (now.getDay() + 6) % 7 // JS: 0 = Вс → у нас 0 = Пн
    const today = week[dayIdx]
    if (!today) return { open: false, label: 'сегодня выходной' }
    const open = minutesOf(today.open)
    const close = minutesOf(today.close)
    if (open == null || close == null) return { open: true, label: '' }
    const cur = now.getHours() * 60 + now.getMinutes()
    const isOpen = cur >= open && cur < close
    return isOpen ? { open: true, label: `до ${fmt(today.close)}` } : { open: false, label: `${fmt(today.open)}–${fmt(today.close)}` }
  }
  const open = store.openTime ? minutesOf(store.openTime) : null
  const close = store.closeTime ? minutesOf(store.closeTime) : null
  if (open == null || close == null) return { open: true, label: '' }
  const cur = now.getHours() * 60 + now.getMinutes()
  const isOpen = open <= close ? cur >= open && cur < close : cur >= open || cur < close
  return isOpen
    ? { open: true, label: `до ${fmt(store.closeTime)}` }
    : { open: false, label: `${fmt(store.openTime)}–${fmt(store.closeTime)}` }
}

/** «Открыто · до 20:00» без висящего разделителя, когда часы не заданы. */
export function hoursLabel(hours: StoreHours): string {
  const state = hours.open ? 'Открыто' : 'Закрыто'
  return hours.label ? `${state} · ${hours.label}` : state
}

/** Можно ли заказать позицию (стоп-лист точки или снята с продажи). */
export function isOrderable(item: MenuItem | null | undefined): boolean {
  return !!item && !item.product.soldOut
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
