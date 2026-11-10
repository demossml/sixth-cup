/**
 * Макет меню: модель холста, нормализация, резолв каталога и миграция старых (flow) макетов.
 *
 * Начиная с этой версии лист — **холст**: каждый блок живёт в своих координатах
 * (xPct/yPct/wPct/hPct + zIndex) внутри безопасной области листа, а не «течёт» колонками.
 * Старые макеты, сохранённые потоковой вёрсткой, при чтении детерминированно раскладываются
 * в сетку координат (`migrateDocToCanvas`), поэтому ничего не теряется и не ломается.
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

/** Виды блоков. header/hero/note/photo/qr — только для чтения старых макетов (мигрируют при чтении). */
export type BlockType =
  | 'product'
  | 'category'
  | 'text'
  | 'image'
  | 'logo'
  | 'divider'
  | 'header'
  | 'hero'
  | 'note'
  | 'photo'
  | 'qr'

export const CANVAS_TYPES: readonly BlockType[] = ['product', 'category', 'text', 'image', 'logo', 'divider']

export type MenuBlock = {
  id: string
  type: BlockType
  // ── геометрия холста (% от безопасной области листа) ──
  /** NaN — блок из старого flow-макета, его разложит migrateDocToCanvas. */
  xPct: number
  yPct: number
  wPct: number
  hPct: number
  zIndex: number
  rotationDeg: number
  hidden: boolean
  // ── данные каталога ──
  productId: number | null
  categoryId: number | null
  titleOverride: string | null
  priceRubOverride: number | null
  priceText: string | null
  showPhoto: boolean
  /** Своё фото позиции: /uploads/… или https://… — сильнее каталога. */
  photoUrlOverride: string | null
  badge: string | null
  // ── содержимое свободных блоков ──
  text: string | null
  /** image: адрес картинки. */
  url: string | null
  /** image: как вписывать картинку в рамку. */
  fit: 'cover' | 'contain'
  /** text: кегль в pt, выравнивание, жирность. */
  fontSizePt: number
  align: 'left' | 'center' | 'right'
  bold: boolean
  // ── снапшот каталога (frozen / баннер цен) ──
  snapshotPriceRub: number | null
  snapshotName: string | null
  snapshotImageUrl: string | null
  sortOrder: number
}

export type MenuPage = { id: string; blocks: MenuBlock[] }
export type MenuDoc = { pages: MenuPage[] }

export type MenuTheme = {
  preset: 'classic' | 'dark' | 'season'
  bg: string
  text: string
  accent: string
  /** Фоновое изображение листа (необязательно). */
  backgroundImageUrl: string | null
  /** Затемнение фона под картинкой, 0..80 %. */
  backgroundDim: number
  fontHeading: 'Unbounded' | 'Golos Text'
  fontBody: 'Golos Text' | 'Unbounded'
  itemSize: number
  ornament: 'none' | 'line' | 'beans' | 'leaf'
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
  backgroundImageUrl: null,
  backgroundDim: 0,
  fontHeading: 'Unbounded',
  fontBody: 'Golos Text',
  itemSize: 10.5,
  ornament: 'line',
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
const str = (v: unknown, max = 300): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
const intOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

export function normalizeTheme(raw: unknown): MenuTheme {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const preset = oneOf(t.preset, ['classic', 'dark', 'season'] as const, 'classic')
  const base = THEME_PRESETS[preset]
  return {
    preset,
    bg: hex(t.bg, base.bg),
    text: hex(t.text, base.text),
    accent: hex(t.accent, base.accent),
    backgroundImageUrl: str(t.backgroundImageUrl, 500),
    backgroundDim: num(t.backgroundDim, 0, 80, 0),
    fontHeading: oneOf(t.fontHeading, ['Unbounded', 'Golos Text'] as const, DEFAULT_THEME.fontHeading),
    fontBody: oneOf(t.fontBody, ['Golos Text', 'Unbounded'] as const, DEFAULT_THEME.fontBody),
    itemSize: num(t.itemSize, 8, 16, DEFAULT_THEME.itemSize),
    ornament: oneOf(t.ornament, ['none', 'line', 'beans', 'leaf'] as const, 'line'),
    logoPosition: oneOf(t.logoPosition, ['left', 'top-right', 'footer'] as const, 'left'),
  }
}

/** Размеры по умолчанию: новый блок встаёт предсказуемо, а не «во весь лист». */
export const DEFAULT_RECT: Record<BlockType, { w: number; h: number }> = {
  product: { w: 40, h: 7 },
  category: { w: 40, h: 6 },
  text: { w: 36, h: 8 },
  image: { w: 28, h: 22 },
  logo: { w: 32, h: 7 },
  divider: { w: 40, h: 2 },
  header: { w: 40, h: 6 },
  hero: { w: 60, h: 12 },
  note: { w: 40, h: 10 },
  photo: { w: 40, h: 20 },
  qr: { w: 20, h: 20 },
}

const BLOCK_TYPES: readonly BlockType[] = [
  'product', 'category', 'text', 'image', 'logo', 'divider', 'header', 'hero', 'note', 'photo', 'qr',
]

function normalizeBlock(raw: unknown, index: number): MenuBlock | null {
  const b = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!b) return null
  const type = oneOf(b.type, BLOCK_TYPES, 'text')
  const id =
    typeof b.id === 'string' && b.id.trim()
      ? b.id.trim().slice(0, 64)
      : `b-${index}-${Math.random().toString(36).slice(2, 8)}`
  const def = DEFAULT_RECT[type] ?? DEFAULT_RECT.text
  // Отсутствие xPct/yPct — признак старого (flow) блока: NaN, чтобы миграция его увидела.
  const hasCanvas = Number.isFinite(Number(b.xPct)) && Number.isFinite(Number(b.yPct))
  return {
    id,
    type,
    xPct: hasCanvas ? num(b.xPct, 0, 100, 0) : Number.NaN,
    yPct: hasCanvas ? num(b.yPct, 0, 100, 0) : Number.NaN,
    wPct: num(b.wPct, 2, 100, def.w),
    hPct: num(b.hPct, 1, 100, def.h),
    zIndex: num(b.zIndex, 0, 9999, index),
    rotationDeg: num(b.rotationDeg, -180, 180, 0),
    hidden: b.hidden === true,
    productId: intOrNull(b.productId),
    categoryId: intOrNull(b.categoryId),
    titleOverride: str(b.titleOverride, 120),
    priceRubOverride: intOrNull(b.priceRubOverride),
    priceText: str(b.priceText, 40),
    showPhoto: b.showPhoto === true,
    photoUrlOverride: str(b.photoUrlOverride, 500),
    badge: str(b.badge, 16),
    text: str(b.text, 400),
    url: str(b.url, 500),
    fit: oneOf(b.fit, ['cover', 'contain'] as const, 'cover'),
    fontSizePt: num(b.fontSizePt, 5, 72, 10),
    align: oneOf(b.align, ['left', 'center', 'right'] as const, 'left'),
    bold: b.bold === true,
    snapshotPriceRub: intOrNull(b.snapshotPriceRub),
    snapshotName: str(b.snapshotName, 120),
    snapshotImageUrl: str(b.snapshotImageUrl, 400),
    sortOrder: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : index,
  }
}

export const hasCanvasPosition = (b: MenuBlock): boolean =>
  Number.isFinite(b.xPct) && Number.isFinite(b.yPct)

export function normalizeDoc(raw: unknown): MenuDoc {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pagesIn = Array.isArray(d.pages) ? d.pages : []
  const pages: MenuPage[] = pagesIn.map((p, pi) => {
    const page = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
    const blocksIn = Array.isArray(page.blocks) ? page.blocks : []
    const blocks = blocksIn
      .map((b, bi) => normalizeBlock(b, bi))
      .filter((b): b is MenuBlock => !!b)
      .sort((a, b) => a.zIndex - b.zIndex || a.sortOrder - b.sortOrder)
    return {
      id: typeof page.id === 'string' && page.id.trim() ? page.id.trim().slice(0, 64) : `page-${pi + 1}`,
      blocks,
    }
  })
  if (pages.length === 0) pages.push({ id: 'page-1', blocks: [] })
  return { pages }
}

/* ───────────── миграция старых flow-макетов в координаты ───────────── */

/** Потоковая группировка прежней версии. Используется ТОЛЬКО миграцией, не в рантайме. */
export type FlowGroup = { category: MenuBlock | null; products: MenuBlock[] }

export function flowGroups(blocks: MenuBlock[]): { lead: MenuBlock[]; groups: FlowGroup[]; tail: MenuBlock[] } {
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
  return { lead, groups, tail }
}

const COL_W = 44
const COL_GAP = 6
const ROW_PRODUCT = 8.2
const ROW_CATEGORY = 7.5

/**
 * Детерминированно раскладывает старый поток в координаты:
 * шапка и заголовок сверху, категории и позиции — двумя колонками, подвал внизу.
 * Одинаковый вход → одинаковый результат, поэтому повторное чтение ничего не «двигает».
 */
export function migrateDocToCanvas(doc: MenuDoc): MenuDoc {
  return {
    pages: doc.pages.map((page) => {
      if (page.blocks.length === 0) return page
      if (page.blocks.every(hasCanvasPosition)) return page

      const { lead, groups, tail } = flowGroups(page.blocks)
      const out: MenuBlock[] = []
      let z = 0
      let y = 0

      for (const b of lead) {
        if (b.type === 'header') {
          out.push({ ...b, type: 'logo', xPct: 0, yPct: 0, wPct: 34, hPct: 6, zIndex: z++ })
          y = Math.max(y, 6)
        } else if (b.type === 'hero') {
          if (b.text) {
            out.push({
              ...b,
              id: `${b.id}-kicker`,
              type: 'text',
              text: b.text,
              titleOverride: null,
              fontSizePt: 7,
              bold: true,
              xPct: 0,
              yPct: y,
              wPct: 60,
              hPct: 3,
              zIndex: z++,
            })
          }
          out.push({
            ...b,
            type: 'text',
            text: b.titleOverride ?? 'Меню',
            titleOverride: null,
            fontSizePt: 34,
            xPct: 0,
            yPct: Math.max(y + (b.text ? 4 : 0), 4),
            wPct: 78,
            hPct: 13,
            zIndex: z++,
          })
          y = Math.max(y, 24)
        } else {
          out.push({ ...b, xPct: 0, yPct: y, wPct: 60, hPct: 6, zIndex: z++ })
          y += 7
        }
      }

      const columnTop = Math.max(y, 24)
      const totals = groups.reduce((s, g) => s + g.products.length + 1, 0)
      const perColumn = Math.max(1, Math.ceil(totals / 2))
      let col = 0
      let colY = columnTop
      let used = 0

      for (const g of groups) {
        const weight = g.products.length + 1
        if (col === 0 && used > 0 && used + weight > perColumn) {
          col = 1
          colY = columnTop
          used = 0
        }
        const x = col === 0 ? 0 : COL_W + COL_GAP
        if (g.category) {
          out.push({ ...g.category, xPct: x, yPct: colY, wPct: COL_W, hPct: ROW_CATEGORY - 1.5, zIndex: z++ })
          colY += ROW_CATEGORY
          used += 1
        }
        for (const p of g.products) {
          out.push({ ...p, xPct: x, yPct: colY, wPct: COL_W, hPct: ROW_PRODUCT - 1.8, zIndex: z++ })
          colY += ROW_PRODUCT
          used += 1
        }
      }

      let tailY = 86
      for (const b of tail) {
        if (b.type === 'divider') {
          out.push({ ...b, xPct: 0, yPct: tailY, wPct: 100, hPct: 1.5, zIndex: z++ })
          tailY += 4
          continue
        }
        if (b.type === 'photo' && b.snapshotImageUrl) {
          out.push({ ...b, type: 'image', url: b.snapshotImageUrl, fit: 'cover', xPct: 0, yPct: tailY, wPct: 34, hPct: 14, zIndex: z++ })
          out.push({
            ...b,
            id: `${b.id}-caption`,
            type: 'text',
            text: b.titleOverride ?? '6.7 Coffee',
            titleOverride: null,
            fontSizePt: 9,
            xPct: 37,
            yPct: tailY,
            wPct: 45,
            hPct: 8,
            zIndex: z++,
          })
          tailY += 16
          continue
        }
        const content =
          b.type === 'note'
            ? b.titleOverride ?? b.text ?? 'Заметка'
            : b.type === 'qr'
              ? 'Меню по QR · 67coffee.ru'
              : b.titleOverride ?? 'Текст'
        out.push({
          ...b,
          type: 'text',
          text: content,
          titleOverride: null,
          fontSizePt: 9,
          xPct: 0,
          yPct: tailY,
          wPct: 60,
          hPct: 8,
          zIndex: z++,
        })
        tailY += 10
      }

      return { ...page, blocks: out }
    }),
  }
}

/* ───────────── каталог и резолв ───────────── */

/** Продукт каталога, как его видит макет. */
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
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.price, p.image_url AS imageUrl, p.available,
              p.category_id AS categoryId, c.name AS categoryName,
              p.variant_label AS variantLabel, p.size_value AS sizeValue, p.size_unit AS sizeUnit
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id IN (${unique.map(() => '?').join(',')})`,
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

export type RenderBlock = MenuBlock & {
  product?: {
    name: string
    priceRub: number | null
    imageUrl: string | null
    available: boolean
    variantLabel: string | null
    categoryName: string | null
  } | null
  catalogPriceRub?: number | null
  displayName?: string
  displayPrice?: string | null
  displayCategory?: string | null
  /** Итоговый адрес картинки: своё фото → каталог → снапшот. */
  displayImageUrl?: string | null
  warnings: string[]
}

export type ResolvedPage = { id: string; blocks: RenderBlock[] }
export type ResolvedDoc = { pages: ResolvedPage[] }

/**
 * Подставляет данные каталога в блоки.
 * live — цена и фото из каталога; frozen — из снапшота. Правка в макете сильнее любого источника.
 */
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
        if (b.type !== 'product') {
          const warnings: string[] = []
          if (b.type === 'image' && !b.url) warnings.push('нет картинки')
          return { ...b, warnings }
        }

        const live = b.productId == null ? null : catalog.get(b.productId) ?? null
        const warnings: string[] = []
        if (b.productId != null && !live) warnings.push('позиции больше нет в каталоге')
        if (live && !live.available) warnings.push('не в продаже (выключена в каталоге)')

        const frozen = priceMode === 'frozen'
        const priceFromCatalog = frozen ? b.snapshotPriceRub ?? live?.priceRub ?? null : live?.priceRub ?? null
        const priceRub = b.priceRubOverride ?? priceFromCatalog
        const priceText = b.priceText ?? (priceRub != null && priceRub > 0 ? String(priceRub) : null)
        if (!priceText) warnings.push('нет цены')

        const displayName =
          b.titleOverride ?? (frozen ? b.snapshotName ?? live?.name ?? '' : live?.name ?? b.snapshotName ?? '')
        const displayImageUrl = b.photoUrlOverride ?? live?.imageUrl ?? (frozen ? b.snapshotImageUrl : null) ?? null
        if (b.showPhoto && !displayImageUrl) warnings.push('нет фото')

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
                imageUrl: displayImageUrl,
                available: live.available,
                variantLabel: sizeLabel,
                categoryName: live.categoryName,
              }
            : b.snapshotName || b.photoUrlOverride
              ? {
                  name: b.snapshotName ?? displayName,
                  priceRub: b.snapshotPriceRub,
                  imageUrl: displayImageUrl,
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
          displayImageUrl,
        }
      })
      .sort((a, b) => a.zIndex - b.zIndex || a.sortOrder - b.sortOrder),
  }))
  return { pages }
}

/** Проблемы, которые мешают печати: макет можно скачать, но только осознанно (force). */
export function collectBlockers(resolved: ResolvedDoc): { blockId: string; pageId: string; code: string; text: string }[] {
  const out: { blockId: string; pageId: string; code: string; text: string }[] = []
  for (const page of resolved.pages) {
    for (const b of page.blocks) {
      for (const w of b.warnings) {
        const code =
          w === 'нет цены'
            ? 'no_price'
            : w === 'позиции больше нет в каталоге'
              ? 'missing_product'
              : w === 'нет картинки' || w === 'нет фото'
                ? 'no_image'
                : 'notice'
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
