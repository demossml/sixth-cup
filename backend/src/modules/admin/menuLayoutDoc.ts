/**
 * Макет меню: модель документа, нормализация, резолв каталога и раскладка по колонкам.
 *
 * Один и тот же алгоритм раскладки используется превью в админке и PDF: иначе
 * гость увидит на экране одно, а типография напечатает другое.
 */
import { db } from '../../db'

export type LayoutFormat = 'a4_portrait' | 'a4_landscape' | 'a3_portrait' | 'ratio_1_1' | 'screen_16_9'
export type PriceMode = 'live' | 'frozen'
export type LayoutStatus = 'draft' | 'ready'

export const LAYOUT_FORMATS: { id: LayoutFormat; label: string; mm: string; pt: [number, number] }[] = [
  { id: 'a4_portrait', label: 'A4', mm: '210 × 297 мм', pt: [595.28, 841.89] },
  { id: 'a4_landscape', label: 'A4 альбом', mm: '297 × 210 мм', pt: [841.89, 595.28] },
  { id: 'a3_portrait', label: 'A3', mm: '297 × 420 мм', pt: [841.89, 1190.55] },
  { id: 'ratio_1_1', label: '1:1', mm: '210 × 210 мм', pt: [595.28, 595.28] },
  { id: 'screen_16_9', label: 'Экран', mm: '16:9', pt: [640, 360] },
]

export function formatMetrics(format: string): { label: string; mm: string; width: number; height: number } {
  const f = LAYOUT_FORMATS.find((x) => x.id === format) ?? LAYOUT_FORMATS[0]!
  return { label: f.label, mm: f.mm, width: f.pt[0], height: f.pt[1] }
}

export type BlockType =
  | 'header'
  | 'hero'
  | 'category'
  | 'product'
  | 'text'
  | 'note'
  | 'photo'
  | 'divider'
  | 'qr'

export type MenuBlock = {
  id: string
  type: BlockType
  productId: number | null
  categoryId: number | null
  titleOverride: string | null
  /** Числовая цена в макете; пусто — берём из каталога (или снапшота при frozen). */
  priceRubOverride: number | null
  /** Свободный текст цены («169 / 269»), если нужно показать два объёма. */
  priceText: string | null
  showPhoto: boolean
  badge: string | null
  hidden: boolean
  sortOrder: number
  text: string | null
  /** Последняя известная цена каталога: нужна для баннера «каталог изменился» и режима frozen. */
  snapshotPriceRub: number | null
  snapshotName: string | null
  snapshotImageUrl: string | null
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

export const THEME_PRESETS: Record<MenuTheme['preset'], Pick<MenuTheme, 'bg' | 'text' | 'accent'>> = {
  classic: { bg: '#F6F3EE', text: '#14171F', accent: '#002FA7' },
  dark: { bg: '#171A21', text: '#F4EFE6', accent: '#AEBFFF' },
  season: { bg: '#F3E7D3', text: '#2B2119', accent: '#A74B2A' },
}

export const DEFAULT_THEME: MenuTheme = {
  preset: 'classic',
  ...THEME_PRESETS.classic,
  fontHeading: 'Unbounded',
  fontBody: 'Golos Text',
  headingSize: 46,
  itemSize: 10.5,
  columns: 2,
  ornament: 'line',
  density: 'normal',
  logoPosition: 'left',
}

const HEX = /^#[0-9a-f]{6}$/i
const hex = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : fallback)
const num = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback)

export function normalizeTheme(raw: unknown): MenuTheme {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const preset = oneOf(t.preset, ['classic', 'dark', 'season'] as const, 'classic')
  const base = THEME_PRESETS[preset]
  return {
    preset,
    bg: hex(t.bg, base.bg),
    text: hex(t.text, base.text),
    accent: hex(t.accent, base.accent),
    fontHeading: oneOf(t.fontHeading, ['Unbounded', 'Golos Text'] as const, DEFAULT_THEME.fontHeading),
    fontBody: oneOf(t.fontBody, ['Golos Text', 'Unbounded'] as const, DEFAULT_THEME.fontBody),
    headingSize: num(t.headingSize, 28, 72, DEFAULT_THEME.headingSize),
    itemSize: num(t.itemSize, 8, 16, DEFAULT_THEME.itemSize),
    columns: oneOf(String(t.columns ?? 2), ['1', '2', '3'] as const, '2') === '1' ? 1 : oneOf(String(t.columns ?? 2), ['1', '2', '3'] as const, '2') === '3' ? 3 : 2,
    ornament: oneOf(t.ornament, ['none', 'line', 'beans', 'leaf'] as const, 'line'),
    density: oneOf(t.density, ['air', 'normal', 'dense'] as const, 'normal'),
    logoPosition: oneOf(t.logoPosition, ['left', 'top-right', 'footer'] as const, 'left'),
  }
}

const BLOCK_TYPES: readonly BlockType[] = ['header', 'hero', 'category', 'product', 'text', 'note', 'photo', 'divider', 'qr']

function normalizeBlock(raw: unknown, index: number): MenuBlock | null {
  const b = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!b) return null
  const type = oneOf(b.type, BLOCK_TYPES, 'text')
  const id = typeof b.id === 'string' && b.id.trim() ? b.id.trim().slice(0, 64) : `b-${index}-${Math.random().toString(36).slice(2, 8)}`
  const str = (v: unknown, max = 300): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
  const intOrNull = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
  }
  return {
    id,
    type,
    productId: intOrNull(b.productId),
    categoryId: intOrNull(b.categoryId),
    titleOverride: str(b.titleOverride, 120),
    priceRubOverride: intOrNull(b.priceRubOverride),
    priceText: str(b.priceText, 40),
    showPhoto: b.showPhoto === true,
    badge: str(b.badge, 16),
    hidden: b.hidden === true,
    sortOrder: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : index,
    text: str(b.text, 400),
    snapshotPriceRub: intOrNull(b.snapshotPriceRub),
    snapshotName: str(b.snapshotName, 120),
    snapshotImageUrl: str(b.snapshotImageUrl, 400),
  }
}

export function normalizeDoc(raw: unknown): MenuDoc {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pagesIn = Array.isArray(d.pages) ? d.pages : []
  const pages: MenuPage[] = pagesIn.map((p, pi) => {
    const page = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
    const blocksIn = Array.isArray(page.blocks) ? page.blocks : []
    const blocks = blocksIn
      .map((b, bi) => normalizeBlock(b, bi))
      .filter((b): b is MenuBlock => !!b)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    return {
      id: typeof page.id === 'string' && page.id.trim() ? page.id.trim().slice(0, 64) : `page-${pi + 1}`,
      blocks,
    }
  })
  if (pages.length === 0) pages.push({ id: 'page-1', blocks: [] })
  return { pages }
}

/** Продукт каталога, как его видит макет. Фото берём относительным URL (/uploads/...). */
export type CatalogProduct = {
  id: number
  name: string
  priceRub: number
  imageUrl: string | null
  available: boolean
  categoryId: number | null
  categoryName: string | null
  variantLabel: string | null
  sizeValue: number | null
  sizeUnit: string | null
}

export function loadCatalogProducts(ids: number[]): Map<number, CatalogProduct> {
  const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))]
  const out = new Map<number, CatalogProduct>()
  if (unique.length === 0) return out
  const placeholders = unique.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.price, p.image_url AS imageUrl, p.available,
              p.category_id AS categoryId, c.name AS categoryName,
              p.variant_label AS variantLabel, p.size_value AS sizeValue, p.size_unit AS sizeUnit
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id IN (${placeholders})`,
    )
    .all(...unique) as Array<{
      id: number
      name: string
      price: number
      imageUrl: string | null
      available: number
      categoryId: number | null
      categoryName: string | null
      variantLabel: string | null
      sizeValue: number | null
      sizeUnit: string | null
    }>
  for (const r of rows) {
    out.set(Number(r.id), {
      id: Number(r.id),
      name: r.name,
      priceRub: Number(r.price) || 0,
      imageUrl: r.imageUrl ?? null,
      available: !!r.available,
      categoryId: r.categoryId == null ? null : Number(r.categoryId),
      categoryName: r.categoryName ?? null,
      variantLabel: r.variantLabel ?? null,
      sizeValue: r.sizeValue == null ? null : Number(r.sizeValue),
      sizeUnit: r.sizeUnit ?? null,
    })
  }
  return out
}

export type ResolvedProduct = {
  name: string
  priceRub: number | null
  priceText: string | null
  imageUrl: string | null
  available: boolean
  variantLabel: string | null
  categoryName: string | null
}

export type ResolvedBlock = MenuBlock & {
  product?: ResolvedProduct | null
  /** Цена каталога на момент просмотра — чтобы UI показал баннер расхождения. */
  catalogPriceRub?: number | null
  warnings: string[]
}

export type RenderBlock = ResolvedBlock & {
  displayName?: string
  displayPrice?: string | null
  displayCategory?: string | null
}

export type ResolvedPage = { id: string; blocks: RenderBlock[] }
export type ResolvedDoc = { pages: ResolvedPage[] }

/**
 * Подставляет данные каталога в блоки.
 * live — цена и фото всегда из каталога; frozen — из снапшота, снятого при фиксации.
 * Правка в макете (override) сильнее любого источника: это осознанное решение человека.
 */
const categoryNames = (ids: number[]): Map<number, string> => {
  const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))]
  const out = new Map<number, string>()
  if (unique.length === 0) return out
  const rows = db
    .prepare(`SELECT id, name FROM categories WHERE id IN (${unique.map(() => '?').join(',')})`)
    .all(...unique) as { id: number; name: string }[]
  for (const r of rows) out.set(Number(r.id), r.name)
  return out
}

export function resolveDoc(doc: MenuDoc, priceMode: PriceMode): ResolvedDoc {
  const ids = doc.pages
    .flatMap((p) => p.blocks.map((b) => b.productId))
    .filter((n): n is number => typeof n === 'number')
  const catalog = loadCatalogProducts(ids)
  const catNames = categoryNames(
    doc.pages.flatMap((p) => p.blocks.map((b) => b.categoryId)).filter((n): n is number => typeof n === 'number'),
  )

  const pages = doc.pages.map((page) => ({
    id: page.id,
    blocks: page.blocks
      .filter((b) => !b.hidden)
      .map((b): RenderBlock => {
        if (b.type === 'category') {
          const name = b.titleOverride ?? (b.categoryId == null ? null : catNames.get(b.categoryId) ?? null)
          return { ...b, displayCategory: name, warnings: name ? [] : ['категория не найдена'] }
        }
        if (b.type !== 'product') return { ...b, warnings: [] }

        const live = b.productId == null ? null : catalog.get(b.productId) ?? null
        const warnings: string[] = []
        if (b.productId != null && !live) warnings.push('позиции больше нет в каталоге')
        if (live && !live.available) warnings.push('скрыта в каталоге')

        const frozen = priceMode === 'frozen'
        const priceFromCatalog = frozen ? b.snapshotPriceRub ?? live?.priceRub ?? null : live?.priceRub ?? null
        const priceRub = b.priceRubOverride ?? priceFromCatalog
        const priceText = b.priceText ?? (priceRub != null && priceRub > 0 ? String(priceRub) : null)
        if (!priceText) warnings.push('нет цены')

        const displayName = b.titleOverride ?? (frozen ? b.snapshotName ?? live?.name ?? '' : live?.name ?? b.snapshotName ?? '')
        const imageUrl = live?.imageUrl ?? (frozen ? b.snapshotImageUrl : null) ?? null
        if (b.showPhoto && !imageUrl) warnings.push('нет фото')

        const sizeLabel = live
          ? live.variantLabel ??
            (live.sizeValue && live.sizeUnit ? `${live.sizeValue} ${live.sizeUnit === 'ml' ? 'мл' : live.sizeUnit}` : null)
          : null

        return {
          ...b,
          product: live
            ? {
                name: live.name,
                priceRub: live.priceRub,
                priceText: String(live.priceRub),
                imageUrl: live.imageUrl,
                available: live.available,
                variantLabel: sizeLabel,
                categoryName: live.categoryName,
              }
            : b.snapshotName
              ? {
                  name: b.snapshotName,
                  priceRub: b.snapshotPriceRub,
                  priceText: b.snapshotPriceRub == null ? null : String(b.snapshotPriceRub),
                  imageUrl: b.snapshotImageUrl,
                  available: false,
                  variantLabel: null,
                  categoryName: null,
                }
              : null,
          catalogPriceRub: live?.priceRub ?? null,
          warnings,
          displayName,
          displayPrice: priceText,
          displayCategory: live?.categoryName ?? null,
        }
      }),
  }))
  return { pages }
}

/** Категория и её позиции: единица раскладки, которую не разрываем между колонками. */
export type FlowGroup = { category: RenderBlock | null; products: RenderBlock[] }

export type PageFlow = { lead: RenderBlock[]; columns: FlowGroup[][]; tail: RenderBlock[] }

/**
 * Раскладка страницы: блоки до первой категории — «шапка», позиции группируются под
 * своей категорией, всё после последней категории — «подвал». Категории поровну по колонкам
 * (по количеству позиций, а не по числу категорий) — так лист не «съезжает» на одну сторону.
 */
export function flowPage(blocks: RenderBlock[], columns: number): PageFlow {
  const lead: RenderBlock[] = []
  const groups: FlowGroup[] = []
  const tail: RenderBlock[] = []
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

/** Проблемы, которые мешают печати: макет можно скачать, но только осознанно (force). */
export function collectBlockers(resolved: ResolvedDoc): { blockId: string; pageId: string; code: string; text: string }[] {
  const out: { blockId: string; pageId: string; code: string; text: string }[] = []
  for (const page of resolved.pages) {
    for (const b of page.blocks) {
      if (b.type !== 'product') continue
      for (const w of b.warnings) {
        const code = w === 'нет цены' ? 'no_price' : w === 'позиции больше нет в каталоге' ? 'missing_product' : 'notice'
        out.push({ blockId: b.id, pageId: page.id, code, text: w })
      }
    }
  }
  return out
}

/** Счётчики для карточек списка и шапки редактора. */
export function docStats(resolved: ResolvedDoc): { pages: number; products: number; warnings: number } {
  let products = 0
  let warnings = 0
  for (const page of resolved.pages) {
    for (const b of page.blocks) {
      if (b.type === 'product') products++
      warnings += b.warnings.length
    }
  }
  return { pages: resolved.pages.length, products, warnings }
}
