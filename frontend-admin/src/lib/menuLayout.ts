/**
 * Макет меню: клиентская модель и раскладка.
 *
 * Алгоритм раскладки совпадает с серверным (menuLayoutDoc.flowPage): превью в админке
 * должно показывать ровно то, что уйдёт в PDF, иначе «на экране красиво, в печати нет».
 */

export type BlockType = 'header' | 'hero' | 'category' | 'product' | 'text' | 'note' | 'photo' | 'divider' | 'qr'

export type MenuBlock = {
  id: string
  type: BlockType
  productId: number | null
  categoryId: number | null
  titleOverride: string | null
  priceRubOverride: number | null
  priceText: string | null
  showPhoto: boolean
  badge: string | null
  hidden: boolean
  sortOrder: number
  text: string | null
  snapshotPriceRub: number | null
  snapshotName: string | null
  snapshotImageUrl: string | null
  product?: { name: string; priceRub: number | null; imageUrl: string | null; available: boolean; variantLabel: string | null; categoryName: string | null } | null
  displayName?: string
  displayPrice?: string | null
  displayCategory?: string | null
  catalogPriceRub?: number | null
  warnings?: string[]
}

export type MenuPage = { id: string; blocks: MenuBlock[] }
export type MenuDoc = { pages: MenuPage[] }

export type MenuTheme = {
  preset: 'classic' | 'dark' | 'season'
  bg: string
  text: string
  accent: string
  fontHeading: 'Unbounded' | 'Golos Text'
  fontBody: 'Golos Text' | 'Unbounded'
  headingSize: number
  itemSize: number
  columns: 1 | 2 | 3
  ornament: 'none' | 'line' | 'beans' | 'leaf'
  density: 'air' | 'normal' | 'dense'
  logoPosition: 'left' | 'top-right' | 'footer'
}

export const THEME_PRESETS: Record<MenuTheme['preset'], { bg: string; text: string; accent: string; label: string }> = {
  classic: { bg: '#F6F3EE', text: '#14171F', accent: '#002FA7', label: 'Классика' },
  dark: { bg: '#171A21', text: '#F4EFE6', accent: '#AEBFFF', label: 'Тёмный' },
  season: { bg: '#F3E7D3', text: '#2B2119', accent: '#A74B2A', label: 'Сезон' },
}

export const DEFAULT_THEME: MenuTheme = {
  preset: 'classic',
  bg: THEME_PRESETS.classic.bg,
  text: THEME_PRESETS.classic.text,
  accent: THEME_PRESETS.classic.accent,
  fontHeading: 'Unbounded',
  fontBody: 'Golos Text',
  headingSize: 46,
  itemSize: 10.5,
  columns: 2,
  ornament: 'line',
  density: 'normal',
  logoPosition: 'left',
}

export const LAYOUT_FORMATS = [
  { id: 'a4_portrait', label: 'A4', mm: '210 × 297', ratio: 210 / 297 },
  { id: 'a4_landscape', label: 'A4 альбом', mm: '297 × 210', ratio: 297 / 210 },
  { id: 'a3_portrait', label: 'A3', mm: '297 × 420', ratio: 297 / 420 },
  { id: 'ratio_1_1', label: '1:1', mm: '210 × 210', ratio: 1 },
  { id: 'screen_16_9', label: 'Экран', mm: '16:9', ratio: 16 / 9 },
] as const

export type LayoutFormat = (typeof LAYOUT_FORMATS)[number]['id']

export const formatRatio = (format: string): number =>
  LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? LAYOUT_FORMATS[0].ratio

export const formatLabel = (format: string): string => LAYOUT_FORMATS.find((f) => f.id === format)?.label ?? 'A4'

/* ───────── раскладка ───────── */

export type FlowGroup = { category: MenuBlock | null; products: MenuBlock[] }
export type PageFlow = { lead: MenuBlock[]; columns: FlowGroup[][]; tail: MenuBlock[] }

export function flowPage(blocks: MenuBlock[], columns: number): PageFlow {
  const lead: MenuBlock[] = []
  const groups: FlowGroup[] = []
  const tail: MenuBlock[] = []
  let current: FlowGroup | null = null

  for (const b of blocks) {
    if (b.type === 'category') {
      current = { category: b, products: [] }
      groups.push(current)
      continue
    }
    if (b.type === 'product') {
      if (!current) {
        current = { category: null, products: [] }
        groups.push(current)
      }
      current.products.push(b)
      continue
    }
    if (groups.length === 0) lead.push(b)
    else tail.push(b)
  }

  const count = Math.max(1, Math.min(3, columns))
  // Одна категория — один столбец: рвать список ради «ровных» колонок хуже для чтения.
  const canSplit = groups.length > 1
  const total = groups.reduce((sum, g) => sum + g.products.length + 1, 0)
  const perColumn = Math.max(1, Math.ceil(total / count))
  const buckets: FlowGroup[][] = Array.from({ length: count }, () => [])
  let ci = 0
  let used = 0
  for (const g of groups) {
    if (canSplit && ci < count - 1 && used > 0 && used + g.products.length + 1 > perColumn) {
      ci++
      used = 0
    }
    // Длинную категорию продолжаем в следующей колонке — без заголовка, чтобы не дублировать.
    let chunk: FlowGroup = { category: g.category, products: [] }
    buckets[ci]!.push(chunk)
    used += 1
    for (const p of g.products) {
      if (canSplit && ci < count - 1 && used >= perColumn) {
        ci++
        used = 0
        chunk = { category: null, products: [] }
        buckets[ci]!.push(chunk)
      }
      chunk.products.push(p)
      used++
    }
  }
  const nonEmpty = buckets.filter((b) => b.length > 0)
  return { lead, columns: nonEmpty.length ? nonEmpty : [[{ category: null, products: [] }]], tail }
}

export const visibleBlocks = (blocks: MenuBlock[]): MenuBlock[] => blocks.filter((b) => !b.hidden)

/* ───────── блоки ───────── */

export const uid = (prefix = 'b'): string => `${prefix}-${Math.random().toString(36).slice(2, 9)}`

export function newBlock(type: BlockType, sortOrder: number, extra: Partial<MenuBlock> = {}): MenuBlock {
  return {
    id: uid(type),
    type,
    productId: null,
    categoryId: null,
    titleOverride: null,
    priceRubOverride: null,
    priceText: null,
    showPhoto: false,
    badge: null,
    hidden: false,
    sortOrder,
    text: null,
    snapshotPriceRub: null,
    snapshotName: null,
    snapshotImageUrl: null,
    ...extra,
  }
}

export type CatalogProduct = {
  id: number
  name: string
  price: number
  imageUrl: string | null
  available: boolean
  categoryId: number | null
  categoryName: string | null
  variantLabel: string | null
}

export function productBlock(product: CatalogProduct, sortOrder: number): MenuBlock {
  return newBlock('product', sortOrder, {
    productId: product.id,
    categoryId: product.categoryId,
    snapshotPriceRub: product.price,
    snapshotName: product.name,
    snapshotImageUrl: product.imageUrl,
  })
}

/** Нумерует блоки заново: sortOrder — единственный порядок, который читает сервер. */
export function reindex(blocks: MenuBlock[]): MenuBlock[] {
  return blocks.map((b, i) => ({ ...b, sortOrder: i }))
}

export function moveBlock(blocks: MenuBlock[], id: string, dir: -1 | 1): MenuBlock[] {
  const i = blocks.findIndex((b) => b.id === id)
  if (i < 0) return blocks
  const j = i + dir
  if (j < 0 || j >= blocks.length) return blocks
  const next = [...blocks]
  const tmp = next[i]!
  next[i] = next[j]!
  next[j] = tmp
  return reindex(next)
}

export function toggleHidden(blocks: MenuBlock[], id: string): MenuBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, hidden: !b.hidden } : b))
}

export const blockLabel = (b: MenuBlock): string => {
  switch (b.type) {
    case 'header':
      return 'Шапка с логотипом'
    case 'hero':
      return b.titleOverride ? `Заголовок · ${b.titleOverride}` : 'Заголовок'
    case 'category':
      return b.titleOverride ?? b.displayCategory ?? 'Категория'
    case 'product':
      return b.displayName ?? b.titleOverride ?? b.snapshotName ?? 'Позиция'
    case 'text':
      return b.titleOverride ?? b.text ?? 'Текст'
    case 'note':
      return b.titleOverride ?? 'Заметка'
    case 'photo':
      return b.titleOverride ?? 'Фото-блок'
    case 'divider':
      return 'Линия'
    case 'qr':
      return b.titleOverride ?? 'QR-блок'
    default:
      return b.type
  }
}

export const blockIconName = (type: BlockType): string =>
  type === 'product' ? 'package' : type === 'category' ? 'layers' : type === 'photo' ? 'image' : type === 'note' ? 'sticky-note' : 'type'

/** Подпись под заголовком позиции: объём/вариант из каталога. */
export const productSubline = (b: MenuBlock): string | null => b.product?.variantLabel ?? null

export const priceModeLabel = (mode: 'live' | 'frozen'): string =>
  mode === 'frozen' ? 'цены зафиксированы' : 'цены живые, из каталога'

/** Что показать в баннере расхождения цен. Возвращает null, если показывать нечего. */
export function driftBanner(
  drift: { title: string; from: number | null; to: number | null }[],
  mode: 'live' | 'frozen',
): string | null {
  if (drift.length === 0) return null
  const head = drift.slice(0, 2).map((d) => `${d.title} ${d.from ?? '—'} → ${d.to ?? '—'} ₽`).join(', ')
  const rest = drift.length > 2 ? ` и ещё ${drift.length - 2}` : ''
  return mode === 'frozen'
    ? `В каталоге изменились цены у ${drift.length} поз. ${head}${rest}. В макете цены зафиксированы — так и останется при печати.`
    : `В каталоге изменились цены у ${drift.length} поз. ${head}${rest}. Макет берёт цены из каталога — обновите, чтобы увидеть.`
}

/** Копия документа для undo: без серверных полей, чтобы стек не распухал. */
export const docSnapshot = (doc: MenuDoc): MenuDoc => ({
  pages: doc.pages.map((p) => ({
    id: p.id,
    blocks: p.blocks.map((b) => ({
      id: b.id,
      type: b.type,
      productId: b.productId,
      categoryId: b.categoryId,
      titleOverride: b.titleOverride,
      priceRubOverride: b.priceRubOverride,
      priceText: b.priceText,
      showPhoto: b.showPhoto,
      badge: b.badge,
      hidden: b.hidden,
      sortOrder: b.sortOrder,
      text: b.text,
      snapshotPriceRub: b.snapshotPriceRub,
      snapshotName: b.snapshotName,
      snapshotImageUrl: b.snapshotImageUrl,
    })),
  })),
})

export type Blockers = { code: string; text: string; blockId: string }[]

/**
 * Локальный резолв каталога для мгновенного превью и замечаний.
 * Сервер считает то же самое при сохранении — здесь дублируем, чтобы редактор
 * не ждал round-trip на каждое нажатие клавиши.
 */
export function resolvePreview(doc: MenuDoc, products: CatalogProduct[], mode: 'live' | 'frozen'): MenuDoc {
  const byId = new Map(products.map((p) => [p.id, p]))
  const catName = new Map<number, string>()
  for (const p of products) if (p.categoryId && p.categoryName) catName.set(p.categoryId, p.categoryName)

  return {
    pages: doc.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((b): MenuBlock => {
        if (b.type === 'category') {
          const name = b.titleOverride ?? (b.categoryId ? catName.get(b.categoryId) ?? null : null)
          return { ...b, displayCategory: name, warnings: name ? [] : ['категория не найдена'] }
        }
        if (b.type !== 'product') return { ...b, warnings: [] }

        const live = b.productId == null ? null : byId.get(b.productId) ?? null
        const catalogPrice = mode === 'frozen' ? b.snapshotPriceRub ?? live?.price ?? null : live?.price ?? null
        const priceRub = b.priceRubOverride ?? catalogPrice
        const displayPrice = b.priceText ?? (priceRub != null && priceRub > 0 ? String(priceRub) : null)
        const displayName = b.titleOverride ?? (mode === 'frozen' ? b.snapshotName ?? live?.name ?? '' : live?.name ?? b.snapshotName ?? '')
        const imageUrl = live?.imageUrl ?? (mode === 'frozen' ? b.snapshotImageUrl : null) ?? null
        const warnings: string[] = []
        if (b.productId != null && !live) warnings.push('позиции больше нет в каталоге')
        if (live && !live.available) warnings.push('скрыта в каталоге')
        if (!displayPrice) warnings.push('нет цены')
        if (b.showPhoto && !imageUrl) warnings.push('нет фото')

        return {
          ...b,
          product: live
            ? {
                name: live.name,
                priceRub: live.price,
                imageUrl,
                available: live.available,
                variantLabel: live.variantLabel,
                categoryName: live.categoryName,
              }
            : b.snapshotName
              ? {
                  name: b.snapshotName,
                  priceRub: b.snapshotPriceRub,
                  imageUrl: b.snapshotImageUrl,
                  available: false,
                  variantLabel: null,
                  categoryName: null,
                }
              : null,
          catalogPriceRub: live?.price ?? null,
          displayName,
          displayPrice,
          warnings,
        }
      }),
    })),
  }
}

/** Расхождения цен со снапшотом — для баннера «каталог изменился». */
export function localDrift(doc: MenuDoc, products: CatalogProduct[]): { blockId: string; title: string; from: number | null; to: number | null }[] {
  const byId = new Map(products.map((p) => [p.id, p]))
  const out: { blockId: string; title: string; from: number | null; to: number | null }[] = []
  for (const page of doc.pages) {
    for (const b of page.blocks) {
      if (b.type !== 'product' || b.priceRubOverride != null || b.productId == null) continue
      const live = byId.get(b.productId)
      if (!live || b.snapshotPriceRub == null) continue
      if (live.price !== b.snapshotPriceRub) {
        out.push({ blockId: b.id, title: b.titleOverride ?? live.name, from: b.snapshotPriceRub, to: live.price })
      }
    }
  }
  return out
}
