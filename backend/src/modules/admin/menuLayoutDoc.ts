/**
 * Макет меню: модель холста, нормализация, резолв каталога и миграция старых (flow) макетов.
 *
 * Начиная с этой версии лист — **холст**: каждый блок живёт в своих координатах
 * (xPct/yPct/wPct/hPct + zIndex) внутри безопасной области листа, а не «течёт» колонками.
 * Старые макеты, сохранённые потоковой вёрсткой, при чтении детерминированно раскладываются
 * в сетку координат (`migrateDocToCanvas`), поэтому ничего не теряется и не ломается.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../../db'
import { config } from '../../config'

export type LayoutFormat = 'a4_portrait' | 'a4_landscape' | 'a5_portrait' | 'a3_portrait' | 'ratio_1_1' | 'screen_16_9'
export type PriceMode = 'live' | 'frozen'
export type LayoutStatus = 'draft' | 'ready'

export const LAYOUT_FORMATS: { id: LayoutFormat; label: string; mm: string; pt: [number, number] }[] = [
  { id: 'a4_portrait', label: 'A4', mm: '210 × 297 мм', pt: [595.28, 841.89] },
  { id: 'a4_landscape', label: 'A4 альбом', mm: '297 × 210 мм', pt: [841.89, 595.28] },
  { id: 'a5_portrait', label: 'A5', mm: '148 × 210 мм', pt: [419.53, 595.28] },
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
  /** Кадрирование фото: масштаб 1–3 и точка фокуса (0…1 по осям). */
  photoCrop: { zoom: number; x: number; y: number } | null
  /** text: кегль в pt, выравнивание, жирность, регистр. */
  fontSizePt: number
  align: 'left' | 'center' | 'right'
  bold: boolean
  /** Межстрочный интервал, 1.0–1.8. */
  lineHeight: number
  /** Трекинг в тысячных долях em: 0 — как есть, 100 — разреженный текст. */
  tracking: number
  /** Весь текст блока капсом — «250 мл» → «250 МЛ». */
  uppercase: boolean
  /** Замок: блок виден и печатается, но не двигается и не ресайзится мышью. */
  locked: boolean
  /** Группа блоков: выделяются и двигаются вместе. */
  groupId: string | null
  // ── снапшот каталога (frozen / баннер цен) ──
  snapshotPriceRub: number | null
  snapshotName: string | null
  snapshotImageUrl: string | null
  /** Снимок объёмов на момент фиксации цен (frozen): label + цена. */
  snapshotSizes: { label: string; price: string }[] | null
  sortOrder: number
  /** Блок отрисован движком раскладки для позиции секции (v2). */
  itemId?: string | null
  /** true — блок поставил человек: раскладка его не двигает и не удаляет. */
  pinned?: boolean
}

/** Объём позиции: цена из каталога (объёмы/варианты группы) или задана руками. */
export type ItemSize = {
  label: string
  source: 'catalog' | 'manual'
  /** Вариант группы — это отдельный товар каталога. */
  productId: number | null
  /** Строка `volume_scheme_items`, к которой привязана цена. */
  volumeItemId: number | null
  priceRubOverride: number | null
}

/** Позиция семантического макета: один товар каталога и его объёмы. */
export type MenuItem = {
  id: string
  productId: number | null
  groupId: number | null
  titleOverride: string | null
  description: string | null
  badge: string | null
  showPhoto: boolean
  photoUrlOverride: string | null
  sizes: ItemSize[]
  hidden: boolean
}

/** Секция листа: заголовок + позиции. Раскладка превращает её в блоки с координатами. */
export type MenuSection = {
  id: string
  title: string
  categoryId: number | null
  items: MenuItem[]
  style: { showPhotos: boolean }
}

export type MenuPage = { id: string; blocks: MenuBlock[]; sections?: MenuSection[]; template?: string | null }
/** schemaVersion 2 добавляет секции и объёмы; блоки остаются языком рендера. */
export type MenuDoc = { pages: MenuPage[]; schemaVersion?: number }

export const DOC_SCHEMA_VERSION = 2

/** Загруженные шрифты тоже можно выбрать в теме: берём имя из таблицы. */
function knownFamily(value: unknown, fallback: string): FontFamily | string {
  if (typeof value !== 'string' || !value) return fallback
  if ((FONT_FAMILIES as readonly string[]).includes(value)) return value
  try {
    const row = db.prepare('SELECT family FROM menu_fonts WHERE family=?').get(value) as { family: string } | undefined
    return row ? row.family : fallback
  } catch {
    // Таблицы может не быть на очень старой базе — тогда только встроенные семейства.
    return fallback
  }
}

/** Семейства, у которых есть файл и в админке, и в PDF (кириллица + ₽ проверены). */
export const FONT_FAMILIES = ['Unbounded', 'Golos Text', 'Manrope', 'Montserrat', 'Lora', 'PT Serif', 'Oswald'] as const
export type FontFamily = (typeof FONT_FAMILIES)[number]

export type MenuTheme = {
  preset: 'classic' | 'dark' | 'season'
  bg: string
  text: string
  accent: string
  /** Фоновое изображение листа (необязательно). */
  backgroundImageUrl: string | null
  /** Затемнение фона под картинкой, 0..80 %. */
  backgroundDim: number
  /** Семейство шрифта: встроенное или имя загруженного шрифта. */
  fontHeading: string
  fontBody: string
  itemSize: number
  ornament: 'none' | 'line' | 'beans' | 'leaf'
  logoPosition: 'left' | 'top-right' | 'footer'
  /** Недавние цвета пользователя — общие для макета, чтобы не подбирать заново. */
  recentColors?: string[]
  /** Градиент фона листа. null — сплошной цвет `bg`. */
  gradient: { from: string; to: string; angle: number } | null
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
  gradient: null,
  ornament: 'line',
  logoPosition: 'left',
}

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i
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
    fontHeading: knownFamily(t.fontHeading, DEFAULT_THEME.fontHeading),
    fontBody: knownFamily(t.fontBody, DEFAULT_THEME.fontBody),
    itemSize: num(t.itemSize, 8, 16, DEFAULT_THEME.itemSize),
    ornament: oneOf(t.ornament, ['none', 'line', 'beans', 'leaf'] as const, 'line'),
    logoPosition: oneOf(t.logoPosition, ['left', 'top-right', 'footer'] as const, 'left'),
    recentColors: Array.isArray(t.recentColors)
      ? t.recentColors.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 8)
      : [],
    gradient: (() => {
      const g = (t.gradient && typeof t.gradient === 'object' ? t.gradient : null) as Record<string, unknown> | null
      if (!g) return null
      const from = hex(g.from, '')
      const to = hex(g.to, '')
      if (!from || !to) return null
      return { from, to, angle: num(g.angle, 0, 360, 135) }
    })(),
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

/** Внешние ссылки в макете не храним: только файлы из uploads админки. */
const sanitizeUploads = (url: string | null): string | null => (url && isUploadsUrl(url) ? url : null)

const normalizeSizes = (raw: unknown): { label: string; price: string }[] | null => {
  if (!Array.isArray(raw)) return null
  const out = raw
    .map((x) => {
      const o = (x && typeof x === 'object' ? x : null) as Record<string, unknown> | null
      if (!o) return null
      const label = str(o.label, 24)
      if (!label) return null
      return { label, price: str(o.price, 16) ?? '' }
    })
    .filter((x): x is { label: string; price: string } => x != null)
    .slice(0, 8)
  return out.length ? out : null
}

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
    photoUrlOverride: sanitizeUploads(str(b.photoUrlOverride, 500)),
    badge: str(b.badge, 16),
    text: str(b.text, 400),
    url: sanitizeUploads(str(b.url, 500)),
    fit: oneOf(b.fit, ['cover', 'contain'] as const, 'cover'),
    photoCrop: (() => {
      const c = (b.photoCrop && typeof b.photoCrop === 'object' ? b.photoCrop : null) as Record<string, unknown> | null
      if (!c) return null
      return { zoom: num(c.zoom, 1, 3, 1), x: num(c.x, 0, 1, 0.5), y: num(c.y, 0, 1, 0.5) }
    })(),
    fontSizePt: num(b.fontSizePt, 5, 72, 10),
    align: oneOf(b.align, ['left', 'center', 'right'] as const, 'left'),
    bold: b.bold === true,
    lineHeight: num(b.lineHeight, 0.9, 1.8, 1.15),
    tracking: num(b.tracking, -50, 200, 0),
    uppercase: b.uppercase === true,
    locked: b.locked === true,
    groupId: str(b.groupId, 64),
    snapshotPriceRub: intOrNull(b.snapshotPriceRub),
    snapshotName: str(b.snapshotName, 120),
    snapshotImageUrl: str(b.snapshotImageUrl, 400),
    snapshotSizes: normalizeSizes(b.snapshotSizes),
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
    const sections = Array.isArray(page.sections)
      ? page.sections.map((x, si) => normalizeSection(x, si)).filter((x): x is MenuSection => !!x)
      : undefined
    return {
      id: typeof page.id === 'string' && page.id.trim() ? page.id.trim().slice(0, 64) : `page-${pi + 1}`,
      blocks,
      ...(sections ? { sections } : {}),
      ...(typeof page.template === 'string' ? { template: page.template.slice(0, 40) } : {}),
    }
  })
  if (pages.length === 0) pages.push({ id: 'page-1', blocks: [] })
  // v2: секции и объёмы живут рядом с блоками; блоки остаются языком рендера.
  const hasSections = pages.some((p) => (p.sections?.length ?? 0) > 0)
  const version = Number(d.schemaVersion) === 2 || hasSections ? DOC_SCHEMA_VERSION : 1
  return { pages, schemaVersion: version }
}

/** Позиция секции: товар каталога + объёмы. */
function normalizeSize(raw: unknown): ItemSize | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!o) return null
  const label = str(o.label, 24)
  if (!label) return null
  const source = oneOf(o.source, ['catalog', 'manual'] as const, 'catalog')
  return {
    label,
    source,
    productId: intOrNull(o.productId),
    volumeItemId: intOrNull(o.volumeItemId),
    priceRubOverride: intOrNull(o.priceRubOverride),
  }
}

function normalizeItem(raw: unknown, index: number): MenuItem | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!o) return null
  const sizes = Array.isArray(o.sizes) ? o.sizes.map(normalizeSize).filter((x): x is ItemSize => !!x).slice(0, 8) : []
  return {
    id: typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 64) : `it-${index + 1}`,
    productId: intOrNull(o.productId),
    groupId: intOrNull(o.groupId),
    titleOverride: str(o.titleOverride, 120),
    description: str(o.description, 200),
    badge: str(o.badge, 16),
    showPhoto: o.showPhoto !== false,
    photoUrlOverride: sanitizeUploads(str(o.photoUrlOverride, 500)),
    sizes,
    hidden: o.hidden === true,
  }
}

function normalizeSection(raw: unknown, index: number): MenuSection | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!o) return null
  const items = Array.isArray(o.items) ? o.items.map((x, i) => normalizeItem(x, i)).filter((x): x is MenuItem => !!x) : []
  const style = (o.style && typeof o.style === 'object' ? o.style : {}) as Record<string, unknown>
  return {
    id: typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 64) : `sec-${index + 1}`,
    title: str(o.title, 60) ?? 'Без названия',
    categoryId: intOrNull(o.categoryId),
    items,
    style: { showPhotos: style.showPhotos !== false },
  }
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
  const migrated: MenuPage[] = doc.pages.map((page) => {
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
  })
  // schemaVersion и sections переносим как есть: миграция касается только координат блоков.
  return { ...doc, pages: migrated }
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
  /** Объёмы и цены: из схемы объёмов, вариантов группы или один размер товара. */
  sizes: ResolvedSize[]
}

/** Разрешённый объём позиции для печати и превью. */
export type ResolvedSize = { label: string; priceRub: number | null; productId: number; volumeItemId: number | null }

const UPLOADS_URL = /^\/uploads\/[A-Za-z0-9._-]+$/

/** Картинка макета живёт только в uploads админки: внешние URL не тянем (IP-утечка и пустой PDF). */
export function isUploadsUrl(url: string | null | undefined): boolean {
  return !!url && UPLOADS_URL.test(url.split('?')[0]!)
}

/** Файл по `/uploads/...` реально существует на диске. */
export function uploadsFileExists(url: string | null | undefined): boolean {
  if (!isUploadsUrl(url)) return false
  const file = url!.split('?')[0]!.slice('/uploads/'.length)
  if (!/^[A-Za-z0-9._-]+$/.test(file)) return false
  return existsSync(join(config.uploadsDir, file))
}

export function loadCatalogProducts(ids: number[]): Map<number, CatalogProduct> {
  const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))]
  const out = new Map<number, CatalogProduct>()
  if (unique.length === 0) return out
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.price, p.image_url AS imageUrl, p.available,
              p.category_id AS categoryId, c.name AS categoryName,
              p.variant_label AS variantLabel, p.size_value AS sizeValue, p.size_unit AS sizeUnit,
              p.volume_scheme_id AS volumeSchemeId, p.group_id AS groupId, p.variant_sort AS variantSort
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
      volumeSchemeId: number | null
      groupId: number | null
      variantSort: number | null
    }>
  const volumeSizes = loadVolumeSizes(unique)
  const groupSizes = loadGroupSizes(rows.map((r) => r.groupId).filter((n): n is number => n != null))
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
      sizes:
        volumeSizes.get(Number(r.id)) ??
        (r.groupId != null ? groupSizes.get(Number(r.groupId)) : undefined) ??
        [
          {
            label: r.variantLabel ?? sizeLabel(r.sizeValue, r.sizeUnit),
            priceRub: Number(r.price) || 0,
            productId: Number(r.id),
            volumeItemId: null,
          },
        ],
    })
  }
  return out
}

const sizeLabel = (value: number | null, unit: string | null): string =>
  value != null && unit ? `${value} ${unit === 'ml' ? 'мл' : unit === 'g' ? 'г' : unit}` : 'цена'

/**
 * Объёмы из схемы: цена лежит в `product_volume_prices`, подпись — в `volume_scheme_items`.
 * Это единственный источник для «250 / 350 / 450» — руками цену в макете не дублируем.
 */
export function loadVolumeSizes(productIds: number[]): Map<number, ResolvedSize[]> {
  const out = new Map<number, ResolvedSize[]>()
  if (productIds.length === 0) return out
  const rows = db
    .prepare(
      `SELECT pvp.product_id AS productId, pvp.item_id AS volumeItemId, pvp.price,
              v.label AS label, v.sort_order AS sortOrder
         FROM product_volume_prices pvp
         JOIN volume_scheme_items v ON v.id = pvp.item_id
        WHERE pvp.product_id IN (${productIds.map(() => '?').join(',')})
        ORDER BY v.sort_order, v.id`,
    )
    .all(...productIds) as { productId: number; volumeItemId: number; price: number; label: string; sortOrder: number }[]
  for (const r of rows) {
    const list = out.get(Number(r.productId)) ?? []
    list.push({ label: r.label, priceRub: Number(r.price) || 0, productId: Number(r.productId), volumeItemId: Number(r.volumeItemId) })
    out.set(Number(r.productId), list)
  }
  return out
}

/** Варианты группы («Капучино 250 / 350 / 450») — по одному размеру на товар-вариант. */
export function loadGroupSizes(groupIds: number[]): Map<number, ResolvedSize[]> {
  const unique = [...new Set(groupIds.filter((n) => Number.isInteger(n) && n > 0))]
  const out = new Map<number, ResolvedSize[]>()
  if (unique.length === 0) return out
  const rows = db
    .prepare(
      `SELECT id, group_id AS groupId, price, variant_label AS variantLabel, size_value AS sizeValue, size_unit AS sizeUnit
         FROM products
        WHERE group_id IN (${unique.map(() => '?').join(',')}) AND available=1
        ORDER BY variant_sort, id`,
    )
    .all(...unique) as { id: number; groupId: number; price: number; variantLabel: string | null; sizeValue: number | null; sizeUnit: string | null }[]
  for (const r of rows) {
    const list = out.get(Number(r.groupId)) ?? []
    list.push({
      label: r.variantLabel ?? sizeLabel(r.sizeValue, r.sizeUnit),
      priceRub: Number(r.price) || 0,
      productId: Number(r.id),
      volumeItemId: null,
    })
    out.set(Number(r.groupId), list)
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
  /** Объёмы позиции с ценами: «250 мл — 169», «350 мл — 219». Пусто — один размер. */
  displaySizes?: { label: string; price: string }[]
  displayCategory?: string | null
  /** Итоговый адрес картинки: своё фото → каталог → снапшот. */
  displayImageUrl?: string | null
  /** Картинки нет на диске — блокер печати, а не только предупреждение. */
  imageMissing?: boolean
  warnings: string[]
}

export type ResolvedPage = { id: string; blocks: RenderBlock[]; sections?: MenuSection[]; template?: string | null }
/** Резолв каталога + секции v2: клиент редактирует и то, и другое. */
export type ResolvedDoc = { pages: ResolvedPage[]; schemaVersion?: number }

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
          const missing = b.type === 'image' && !!b.url && !uploadsFileExists(b.url)
          if (b.type === 'image') {
            if (!b.url) warnings.push('нет картинки')
            else if (missing) warnings.push('файл картинки не найден')
          }
          return { ...b, warnings, imageMissing: missing }
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

        const baseName = frozen ? b.snapshotName ?? live?.name ?? '' : live?.name ?? b.snapshotName ?? ''
        const displayImageUrl = b.photoUrlOverride ?? live?.imageUrl ?? (frozen ? b.snapshotImageUrl : null) ?? null
        // Объёмы: у позиции может быть 250/350/450 — печатаем одной строкой, а не тремя блоками.
        // Ручная цена в блоке сильнее объёмов каталога; frozen печатает снимок объёмов.
        const catalogSizes = live?.sizes ?? []
        const manualPrice = b.priceRubOverride != null || b.priceText != null
        const sizeSource = frozen && b.snapshotSizes?.length ? b.snapshotSizes : null
        const displaySizes = manualPrice
          ? []
          : sizeSource
            ? sizeSource.map((sz) => ({ label: sz.label, price: sz.price }))
            : catalogSizes.length > 1
              ? catalogSizes.map((sz) => ({ label: sz.label, price: sz.priceRub == null ? '' : String(sz.priceRub) }))
              : []
        // Одна позиция на группу объёмов: «Капучино 350 мл» + объёмы 250/350/400 читается плохо,
        // поэтому в названии убираем хвост варианта, а объёмы печатаем строкой ниже.
        const variant = live?.variantLabel?.trim()
        const stripped =
          displaySizes.length > 1 && variant && baseName.toLowerCase().endsWith(variant.toLowerCase())
            ? baseName.slice(0, baseName.length - variant.length).trim()
            : baseName
        const displayName = b.titleOverride ?? (stripped || baseName)
        if (b.showPhoto && !displayImageUrl) warnings.push('нет фото')
        else if (b.showPhoto && displayImageUrl && isUploadsUrl(displayImageUrl) && !uploadsFileExists(displayImageUrl)) {
          warnings.push('файл картинки не найден')
        }
        // Внешняя ссылка (например, из старого каталога) в PDF не попадает — честно помечаем.
        if (displayImageUrl && !isUploadsUrl(displayImageUrl)) warnings.push('внешняя ссылка на фото не печатается')

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
          displaySizes,
          imageMissing: !!displayImageUrl && isUploadsUrl(displayImageUrl) && !uploadsFileExists(displayImageUrl),
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
              : w === 'файл картинки не найден'
                ? 'image_unreadable'
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
