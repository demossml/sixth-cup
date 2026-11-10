/**
 * Макет меню: клиентская модель холста и геометрия блоков.
 *
 * Блок живёт в координатах xPct/yPct/wPct/hPct (% от безопасной области листа) и zIndex.
 * Раскладки «потоком» здесь больше нет: сервер отдаёт старые макеты уже переведёнными
 * в координаты, редактор двигает блоки независимо, PDF рисует те же рамки.
 */

export type BlockType = 'product' | 'category' | 'text' | 'image' | 'logo' | 'divider'

/** Legacy-типы встречаются только в непересохранённых старых макетах. */
export type AnyBlockType = BlockType | 'header' | 'hero' | 'note' | 'photo' | 'qr'

export type MenuBlock = {
  id: string
  type: AnyBlockType
  xPct: number
  yPct: number
  wPct: number
  hPct: number
  zIndex: number
  rotationDeg: number
  hidden: boolean
  productId: number | null
  categoryId: number | null
  titleOverride: string | null
  priceRubOverride: number | null
  priceText: string | null
  showPhoto: boolean
  photoUrlOverride: string | null
  badge: string | null
  text: string | null
  url: string | null
  fit: 'cover' | 'contain'
  /** Кадрирование фото: масштаб 1–3 и точка фокуса (0…1 по осям). */
  photoCrop?: { zoom: number; x: number; y: number } | null
  fontSizePt: number
  align: 'left' | 'center' | 'right'
  bold: boolean
  /** Межстрочный интервал, 1.0–1.8. */
  lineHeight?: number
  /** Трекинг в тысячных em. */
  tracking?: number
  /** Текст блока капсом. */
  uppercase?: boolean
  /** Замок: блок не двигается и не тянется мышью, но печатается. */
  locked?: boolean
  /** Группа блоков: выделяются и двигаются вместе. */
  groupId?: string | null
  snapshotPriceRub: number | null
  snapshotName: string | null
  snapshotImageUrl: string | null
  /** Снимок объёмов для frozen-режима. */
  snapshotSizes: { label: string; price: string }[] | null
  sortOrder: number
  // поля резолва с сервера
  product?: { name: string; priceRub: number | null; imageUrl: string | null; available: boolean; variantLabel: string | null; categoryName: string | null } | null
  displayName?: string
  displayPrice?: string | null
  displayCategory?: string | null
  displayImageUrl?: string | null
  /** Объёмы с ценами: печатаются одной строкой, если их больше одного. */
  displaySizes?: { label: string; price: string }[]
  /** Сервер не нашёл файл картинки на диске. */
  imageMissing?: boolean
  catalogPriceRub?: number | null
  warnings?: string[]
}

export type ItemSize = {
  label: string
  source: 'catalog' | 'manual'
  productId: number | null
  volumeItemId: number | null
  priceRubOverride: number | null
}

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

export type MenuSection = {
  id: string
  title: string
  categoryId: number | null
  items: MenuItem[]
  style: { showPhotos: boolean }
}

export type MenuPage = { id: string; blocks: MenuBlock[]; sections?: MenuSection[]; template?: string | null }
export type MenuDoc = { pages: MenuPage[]; schemaVersion?: number }

/** Семейства с кириллицей и знаком ₽: файлы лежат и в админке, и в PDF. */
export const FONT_FAMILIES = ['Unbounded', 'Golos Text', 'Manrope', 'Montserrat', 'Lora', 'PT Serif', 'Oswald'] as const
export type FontFamily = (typeof FONT_FAMILIES)[number]

/** Подписи для списков: где уместно — с намёком на характер шрифта. */
export const FONT_LABELS: Record<FontFamily, string> = {
  Unbounded: 'Unbounded — широкий гротеск',
  'Golos Text': 'Golos Text — нейтральный',
  Manrope: 'Manrope — геометрический',
  Montserrat: 'Montserrat — витринный',
  Lora: 'Lora — антиква',
  'PT Serif': 'PT Serif — классическая антиква',
  Oswald: 'Oswald — узкий, для заголовков',
}

export type MenuTheme = {
  preset: 'classic' | 'dark' | 'season'
  bg: string
  text: string
  accent: string
  backgroundImageUrl: string | null
  backgroundDim: number
  fontHeading: FontFamily
  fontBody: FontFamily
  itemSize: number
  ornament: 'none' | 'line' | 'beans' | 'leaf'
  logoPosition: 'left' | 'top-right' | 'footer'
  /** Недавние цвета: свои, не из палитры бренда. */
  recentColors?: string[]
  /** Градиент фона листа; null — сплошной `bg`. */
  gradient?: { from: string; to: string; angle: number } | null
}

/** Палитра бренда 6.7: шаблоны стартуют с неё, «выйти из бренда» — свободный выбор цвета. */
export const BRAND_COLORS = ['#002FA7', '#001F6B', '#E6ECFF', '#F6F3EE', '#FFFFFF', '#1B1A17', '#C8A26E'] as const

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
  backgroundImageUrl: null,
  backgroundDim: 0,
  fontHeading: 'Unbounded',
  fontBody: 'Golos Text',
  itemSize: 10.5,
  gradient: null,
  ornament: 'line',
  logoPosition: 'left',
}

export const LAYOUT_FORMATS = [
  { id: 'a4_portrait', label: 'A4', mm: '210 × 297', unit: 'мм', ratio: 210 / 297 },
  { id: 'a4_landscape', label: 'A4 альбом', mm: '297 × 210', unit: 'мм', ratio: 297 / 210 },
  { id: 'a5_portrait', label: 'A5', mm: '148 × 210', unit: 'мм', ratio: 148 / 210 },
  { id: 'a3_portrait', label: 'A3', mm: '297 × 420', unit: 'мм', ratio: 297 / 420 },
  { id: 'ratio_1_1', label: '1:1', mm: '210 × 210', unit: 'мм', ratio: 1 },
  // Экран — это пропорция, а не физический размер: миллиметры здесь были бы ложью.
  { id: 'screen_16_9', label: 'Экран', mm: '16:9', unit: 'пропорция', ratio: 16 / 9 },
] as const

export type LayoutFormat = (typeof LAYOUT_FORMATS)[number]['id']

export const formatRatio = (format: string): number =>
  LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? LAYOUT_FORMATS[0].ratio

export const formatLabel = (format: string): string => LAYOUT_FORMATS.find((f) => f.id === format)?.label ?? 'A4'

/** Размер листа словами: «210 × 297 мм» для бумаги, «16:9» для экрана. */
export const formatSize = (format: string): string => {
  const f = LAYOUT_FORMATS.find((x) => x.id === format)
  if (!f) return ''
  return f.unit === 'мм' ? `${f.mm} мм` : f.mm
}

/** Полная подпись: «A4 · 210 × 297 мм», «Экран · 16:9». */
export const formatFull = (format: string): string => {
  const size = formatSize(format)
  return size ? `${formatLabel(format)} · ${size}` : formatLabel(format)
}

/* ───────────── геометрия холста ───────────── */

export const MIN_W = 6
export const MIN_H = 2

export type Rect = { xPct: number; yPct: number; wPct: number; hPct: number }

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** Держит блок внутри листа: не даём уехать за край и потеряться. */
export function clampRect(r: Rect): Rect {
  const w = clamp(r.wPct, MIN_W, 100)
  const h = clamp(r.hPct, MIN_H, 100)
  return {
    xPct: clamp(r.xPct, 0, 100 - w),
    yPct: clamp(r.yPct, 0, 100 - h),
    wPct: w,
    hPct: h,
  }
}

/** Сдвиг блока в процентах листа. */
export const moveRect = (r: Rect, dxPct: number, dyPct: number): Rect =>
  clampRect({ ...r, xPct: r.xPct + dxPct, yPct: r.yPct + dyPct })

export type ResizeHandle = 'se' | 'e' | 's'

/**
 * Изменение размера от правого-нижнего угла (и его рёбер).
 * Левый-верхний угол остаётся на месте: у края листа режем размер, а не сдвигаем блок.
 */
export function resizeRect(r: Rect, handle: ResizeHandle, dxPct: number, dyPct: number): Rect {
  const maxW = Math.max(MIN_W, 100 - r.xPct)
  const maxH = Math.max(MIN_H, 100 - r.yPct)
  const w = clamp(handle === 's' ? r.wPct : r.wPct + dxPct, MIN_W, maxW)
  const h = clamp(handle === 'e' ? r.hPct : r.hPct + dyPct, MIN_H, maxH)
  return { xPct: r.xPct, yPct: r.yPct, wPct: w, hPct: h }
}

export const DEFAULT_RECT: Record<BlockType, { w: number; h: number }> = {
  product: { w: 40, h: 7 },
  category: { w: 40, h: 6 },
  text: { w: 36, h: 8 },
  image: { w: 28, h: 22 },
  logo: { w: 32, h: 7 },
  divider: { w: 40, h: 2 },
}

export const uid = (prefix = 'b'): string => `${prefix}-${Math.random().toString(36).slice(2, 9)}`

export function newBlock(type: BlockType, rect: Partial<Rect> = {}, extra: Partial<MenuBlock> = {}): MenuBlock {
  const def = DEFAULT_RECT[type]
  return {
    id: uid(type),
    type,
    xPct: rect.xPct ?? 0,
    yPct: rect.yPct ?? 0,
    wPct: rect.wPct ?? def.w,
    hPct: rect.hPct ?? def.h,
    zIndex: extra.zIndex ?? 0,
    rotationDeg: 0,
    hidden: false,
    productId: null,
    categoryId: null,
    titleOverride: null,
    priceRubOverride: null,
    priceText: null,
    showPhoto: type === 'product',
    photoUrlOverride: null,
    badge: null,
    text: null,
    url: null,
    fit: 'cover',
    photoCrop: null,
    fontSizePt: 10,
    align: 'left',
    bold: false,
    lineHeight: 1.15,
    tracking: 0,
    uppercase: false,
    locked: false,
    groupId: null,
    snapshotPriceRub: null,
    snapshotName: null,
    snapshotImageUrl: null,
    snapshotSizes: null,
    sortOrder: 0,
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
  /** Группа объёмов: «Капучино 250/350/400» — это три товара с одним groupId. */
  groupId?: number | null
  /** Объёмы из каталога: «250 мл — 169». Один размер — null. */
  prices?: { label: string; priceRub: number | null }[] | null
}

export function productBlock(product: CatalogProduct, rect: Partial<Rect>, z: number): MenuBlock {
  return newBlock('product', rect, {
    productId: product.id,
    categoryId: product.categoryId,
    snapshotPriceRub: product.price,
    snapshotName: product.name,
    snapshotImageUrl: product.imageUrl,
    zIndex: z,
  })
}

/* ───────────── раскладка новых блоков ───────────── */

export const topZ = (blocks: MenuBlock[]): number => blocks.reduce((m, b) => Math.max(m, b.zIndex), 0) + 1

const overlaps = (a: Rect, b: Rect, gapPct = 1): boolean =>
  a.xPct < b.xPct + b.wPct + gapPct &&
  a.xPct + a.wPct + gapPct > b.xPct &&
  a.yPct < b.yPct + b.hPct + gapPct &&
  a.yPct + a.hPct + gapPct > b.yPct

/**
 * Свободное место для нового блока: идём по сетке сверху вниз и ищем ячейку,
 * которая не пересекается с уже стоящими блоками.
 */
export function nextFreeRect(blocks: MenuBlock[], w: number, h: number): Rect {
  const stepY = 2
  for (let y = 0; y + h <= 100; y += stepY) {
    for (const x of [0, w + 4, 2 * (w + 4)]) {
      if (x + w > 100) continue
      const candidate = { xPct: x, yPct: y, wPct: w, hPct: h }
      if (!blocks.some((b) => !b.hidden && overlaps(candidate, b))) return candidate
    }
  }
  return { xPct: 0, yPct: 0, wPct: w, hPct: h }
}

/** Порядок слоёв: сверху — больший zIndex. */
export const byZ = (blocks: MenuBlock[]): MenuBlock[] => [...blocks].sort((a, b) => b.zIndex - a.zIndex)

export function bringToFront(blocks: MenuBlock[], id: string): MenuBlock[] {
  const z = topZ(blocks)
  return blocks.map((b) => (b.id === id ? { ...b, zIndex: z } : b))
}

export function sendToBack(blocks: MenuBlock[], id: string): MenuBlock[] {
  const min = blocks.reduce((m, b) => Math.min(m, b.zIndex), 0)
  return blocks.map((b) => (b.id === id ? { ...b, zIndex: Math.max(0, min - 1) } : b))
}

export function raiseLayer(blocks: MenuBlock[], id: string, dir: -1 | 1): MenuBlock[] {
  return dir === 1 ? bringToFront(blocks, id) : sendToBack(blocks, id)
}

export const reindex = (blocks: MenuBlock[]): MenuBlock[] => blocks.map((b, i) => ({ ...b, sortOrder: i }))

export function toggleHidden(blocks: MenuBlock[], id: string): MenuBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, hidden: !b.hidden } : b))
}

/** Картинки макета живут только в uploads админки — внешние ссылки не печатаются. */
export const isUploadsUrl = (url: string | null | undefined): boolean =>
  !!url && /^\/uploads\/[A-Za-z0-9._-]+$/.test(url.split('?')[0]!)

/** Прилипание блоков друг к другу и к полям листа (этап 3.5). */
export function snapRect(r: Rect, others: Rect[], threshold = 1): { rect: Rect; snappedX: boolean; snappedY: boolean } {
  const near = (value: number, target: number) => Math.abs(value - target) <= threshold
  const xs = [0, 100 - r.wPct, (100 - r.wPct) / 2]
  const ys = [0, 100 - r.hPct, (100 - r.hPct) / 2]
  for (const o of others) {
    xs.push(o.xPct, o.xPct + o.wPct - r.wPct, o.xPct + o.wPct, o.xPct - r.wPct)
    ys.push(o.yPct, o.yPct + o.hPct - r.hPct, o.yPct + o.hPct, o.yPct - r.hPct)
  }

  let x = r.xPct
  let y = r.yPct
  let snappedX = false
  let snappedY = false
  // ближайшая цель выигрывает: иначе блок «дёргается» между линиями
  const bestX = xs.filter((t) => near(r.xPct, t)).sort((a, b) => Math.abs(r.xPct - a) - Math.abs(r.xPct - b))[0]
  const bestY = ys.filter((t) => near(r.yPct, t)).sort((a, b) => Math.abs(r.yPct - a) - Math.abs(r.yPct - b))[0]
  if (bestX != null) {
    x = bestX
    snappedX = true
  }
  if (bestY != null) {
    y = bestY
    snappedY = true
  }
  return { rect: clampRect({ ...r, xPct: x, yPct: y }), snappedX, snappedY }
}

/* ───────────── секции «Места» (schemaVersion 2) ───────────── */

export const docSections = (doc: MenuDoc): { section: MenuSection; pageIdx: number; index: number }[] =>
  doc.pages.flatMap((p, pageIdx) => (p.sections ?? []).map((section, index) => ({ section, pageIdx, index })))

export const itemCount = (section: MenuSection): number => section.items.filter((it) => !it.hidden).length

/** Переставить позицию внутри секции (кнопки ↑↓; -1 вверх, +1 вниз). */
export function moveItem(doc: MenuDoc, sectionId: string, itemId: string, dir: -1 | 1): MenuDoc {
  return mapSections(doc, (s) => {
    if (s.id !== sectionId) return s
    const i = s.items.findIndex((it) => it.id === itemId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= s.items.length) return s
    const items = [...s.items]
    ;[items[i], items[j]] = [items[j]!, items[i]!]
    return { ...s, items }
  })
}

export const toggleItemHidden = (doc: MenuDoc, sectionId: string, itemId: string): MenuDoc =>
  mapSections(doc, (s) =>
    s.id === sectionId ? { ...s, items: s.items.map((it) => (it.id === itemId ? { ...it, hidden: !it.hidden } : it)) } : s,
  )

export const removeItem = (doc: MenuDoc, sectionId: string, itemId: string): MenuDoc =>
  mapSections(doc, (s) => (s.id === sectionId ? { ...s, items: s.items.filter((it) => it.id !== itemId) } : s))

export const renameSection = (doc: MenuDoc, sectionId: string, title: string): MenuDoc =>
  mapSections(doc, (s) => (s.id === sectionId ? { ...s, title: title.trim() || s.title } : s))

function mapSections(doc: MenuDoc, fn: (s: MenuSection) => MenuSection): MenuDoc {
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.sections ? { ...p, sections: p.sections.map(fn) } : p)),
  }
}

/** Позиция из каталога: объёмы идут из каталога, а не копируются руками. */
export function itemFromCatalog(product: CatalogProduct): MenuItem {
  const prices = product.prices ?? []
  return {
    id: `it-${product.id}-${Math.random().toString(36).slice(2, 7)}`,
    productId: product.id,
    groupId: null,
    titleOverride: null,
    description: null,
    badge: null,
    showPhoto: !!product.imageUrl,
    photoUrlOverride: null,
    sizes:
      prices.length > 1
        ? prices.map((sz) => ({
            label: sz.label,
            source: 'catalog' as const,
            productId: product.id,
            volumeItemId: null,
            priceRubOverride: null,
          }))
        : [],
    hidden: false,
  }
}

/** Позиция с этим товаром уже в «Местах» (видимая) — повторно не добавляем. */
export function findItemByProduct(doc: MenuDoc, productId: number): { section: MenuSection; item: MenuItem } | null {
  for (const page of doc.pages) {
    for (const section of page.sections ?? []) {
      const item = section.items.find((it) => it.productId === productId && !it.hidden)
      if (item) return { section, item }
    }
  }
  return null
}

/** Добавить позицию в секцию (или создать секцию, если её нет). */
export function addItemToSection(doc: MenuDoc, sectionId: string | null, product: CatalogProduct): MenuDoc {
  const item = itemFromCatalog(product)
  if (!sectionId) {
    return {
      ...doc,
      pages: doc.pages.map((p, i) =>
        i === 0
          ? {
              ...p,
              sections: [
                ...(p.sections ?? []),
                {
                  id: `sec-${product.categoryId ?? 'new'}-${Math.random().toString(36).slice(2, 6)}`,
                  title: product.categoryName ?? 'Новая секция',
                  categoryId: product.categoryId,
                  style: { showPhotos: true },
                  items: [item],
                },
              ],
            }
          : p,
      ),
    }
  }
  return mapSections(doc, (s) => (s.id === sectionId ? { ...s, items: [...s.items, item] } : s))
}

/* ───────────── один productId = один блок ───────────── */

/** Все позиции каталога, уже стоящие на листе (скрытые блоки не считаются). */
export function usedProductIds(doc: MenuDoc): number[] {
  const ids = new Set<number>()
  for (const page of doc.pages) {
    for (const b of page.blocks) {
      if (b.type === 'product' && !b.hidden && b.productId != null) ids.add(b.productId)
    }
  }
  return [...ids]
}

/** Блоки-дубли: тот же productId встречается больше одного раза. */
export function duplicateProducts(doc: MenuDoc): { productId: number; blockIds: string[] }[] {
  const seen = new Map<number, string[]>()
  for (const page of doc.pages) {
    for (const b of page.blocks) {
      if (b.type !== 'product' || b.hidden || b.productId == null) continue
      const list = seen.get(b.productId) ?? []
      list.push(b.id)
      seen.set(b.productId, list)
    }
  }
  return [...seen.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([productId, blockIds]) => ({ productId, blockIds }))
}

/**
 * Убирает дубли позиций: на каждый productId остаётся первый блок
 * (минимальный sortOrder, затем zIndex), остальные удаляются из макета.
 * Товары каталога не трогаются — это только лист.
 */
export function collapseDuplicateProducts(doc: MenuDoc): MenuDoc {
  const keep = new Map<number, string>()
  const pages = doc.pages.map((page) => {
    const dropped = new Set<string>()
    for (const b of [...page.blocks].sort((a, c) => a.sortOrder - c.sortOrder || a.zIndex - c.zIndex)) {
      if (b.type !== 'product' || b.hidden || b.productId == null) continue
      if (keep.has(b.productId)) dropped.add(b.id)
      else keep.set(b.productId, b.id)
    }
    return { ...page, blocks: page.blocks.filter((b) => !dropped.has(b.id)) }
  })
  return { pages }
}

/** Полный набор «чистых» полей блока — то, что уходит на сервер. */
export const blockPayload = (b: MenuBlock): MenuBlock => ({
  id: b.id,
  type: b.type,
  xPct: round2(b.xPct),
  yPct: round2(b.yPct),
  wPct: round2(b.wPct),
  hPct: round2(b.hPct),
  zIndex: Math.round(b.zIndex),
  rotationDeg: b.rotationDeg,
  hidden: b.hidden,
  productId: b.productId,
  categoryId: b.categoryId,
  titleOverride: b.titleOverride,
  priceRubOverride: b.priceRubOverride,
  priceText: b.priceText,
  showPhoto: b.showPhoto,
  photoUrlOverride: b.photoUrlOverride,
  badge: b.badge,
  text: b.text,
  url: b.url,
  fit: b.fit,
  photoCrop: b.photoCrop ?? null,
  fontSizePt: b.fontSizePt,
  align: b.align,
  bold: b.bold,
  lineHeight: b.lineHeight ?? 1.15,
  tracking: b.tracking ?? 0,
  uppercase: !!b.uppercase,
  locked: !!b.locked,
  groupId: b.groupId ?? null,
  snapshotPriceRub: b.snapshotPriceRub,
  snapshotName: b.snapshotName,
  snapshotImageUrl: b.snapshotImageUrl,
  snapshotSizes: b.snapshotSizes ?? null,
  sortOrder: b.sortOrder,
})

const round2 = (v: number): number => Math.round(v * 100) / 100

export const docPayload = (doc: MenuDoc): MenuDoc => ({
  // Секции — источник правды для «Мест»: без них сохранение с холста стирало бы раскладку.
  ...(doc.schemaVersion ? { schemaVersion: doc.schemaVersion } : {}),
  pages: doc.pages.map((p) => ({
    id: p.id,
    blocks: p.blocks.map(blockPayload),
    ...(p.sections ? { sections: p.sections } : {}),
    ...(p.template ? { template: p.template } : {}),
  })),
})

/** Копия документа для undo. */
export const docSnapshot = (doc: MenuDoc): MenuDoc => docPayload(doc)

export const blockLabel = (b: MenuBlock): string => {
  switch (b.type) {
    case 'product':
      return b.displayName ?? b.titleOverride ?? b.snapshotName ?? 'Позиция'
    case 'category':
      return b.titleOverride ?? b.displayCategory ?? 'Категория'
    case 'text':
      return b.text ?? b.titleOverride ?? 'Текст'
    case 'image':
      return b.titleOverride ?? 'Картинка'
    case 'logo':
      return 'Логотип 6.7'
    case 'divider':
      return 'Разделитель'
    default:
      return b.type
  }
}

/** Тип блока для старых макетов, если сервер ещё не смигрировал. */
export const effectiveType = (b: MenuBlock): BlockType =>
  (['product', 'category', 'text', 'image', 'logo', 'divider'] as const).includes(b.type as BlockType)
    ? (b.type as BlockType)
    : b.type === 'photo'
      ? 'image'
      : 'text'

export const priceModeLabel = (mode: 'live' | 'frozen'): string =>
  mode === 'frozen' ? 'цены зафиксированы' : 'цены живые, из каталога'

/** Что показать в баннере расхождения цен. null — показывать нечего. */
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

/* ───────────── локальный резолв ───────────── */

/**
 * Резолв каталога на клиенте: мгновенное превью и замечания без round-trip.
 * Сервер считает то же самое при сохранении.
 */
export function resolvePreview(doc: MenuDoc, products: CatalogProduct[], mode: 'live' | 'frozen'): MenuDoc {
  const byId = new Map(products.map((p) => [p.id, p]))
  const catName = new Map<number, string>()
  for (const p of products) if (p.categoryId && p.categoryName) catName.set(p.categoryId, p.categoryName)

  return {
    pages: doc.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((b): MenuBlock => {
        if (effectiveType(b) === 'category') {
          const name = b.titleOverride ?? (b.categoryId ? catName.get(b.categoryId) ?? null : null)
          return { ...b, displayCategory: name, warnings: name ? [] : ['категория не найдена'] }
        }
        if (effectiveType(b) !== 'product') {
          const warnings: string[] = []
          if (effectiveType(b) === 'image' && !b.url && !b.displayImageUrl) warnings.push('нет картинки')
          else if (b.imageMissing) warnings.push('файл картинки не найден')
          return { ...b, warnings }
        }

        const live = b.productId == null ? null : byId.get(b.productId) ?? null
        const catalogPrice = mode === 'frozen' ? b.snapshotPriceRub ?? live?.price ?? null : live?.price ?? null
        const priceRub = b.priceRubOverride ?? catalogPrice
        const displayPrice = b.priceText ?? (priceRub != null && priceRub > 0 ? String(priceRub) : null)
        const baseName = mode === 'frozen' ? b.snapshotName ?? live?.name ?? '' : live?.name ?? b.snapshotName ?? ''
        // Одна позиция на группу объёмов: хвост варианта («350 мл») убираем, объёмы печатаем строкой.
        const variant = live?.variantLabel?.trim()
        const displayImageUrl =
          b.photoUrlOverride ?? live?.imageUrl ?? (mode === 'frozen' ? b.snapshotImageUrl : null) ?? null
        // Объёмы: «250 · 350 · 450» одной строкой. Ручная цена сильнее каталога, frozen берёт снимок.
        const manualPrice = b.priceRubOverride != null || b.priceText != null
        const sizeSource = mode === 'frozen' && b.snapshotSizes?.length ? b.snapshotSizes : null
        const catalogSizes = live?.prices ?? []
        const displaySizes = manualPrice
          ? []
          : sizeSource
            ? sizeSource.map((sz) => ({ label: sz.label, price: sz.price }))
            : catalogSizes.length > 1
              ? catalogSizes.map((sz) => ({ label: sz.label, price: sz.priceRub == null ? '' : String(sz.priceRub) }))
              : []

        const stripped =
          displaySizes.length > 1 && variant && baseName.toLowerCase().endsWith(variant.toLowerCase())
            ? baseName.slice(0, baseName.length - variant.length).trim()
            : baseName
        const displayName = b.titleOverride ?? (stripped || baseName)

        const warnings: string[] = []
        if (b.productId != null && !live) warnings.push('позиции больше нет в каталоге')
        if (live && !live.available) warnings.push('не в продаже (выключена в каталоге)')
        if (!displayPrice) warnings.push('нет цены')
        if (b.showPhoto && !displayImageUrl) warnings.push('нет фото')
        else if (b.imageMissing) warnings.push('файл картинки не найден')

        return {
          ...b,
          product: live
            ? {
                name: live.name,
                priceRub: live.price,
                imageUrl: displayImageUrl,
                available: live.available,
                variantLabel: live.variantLabel,
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
          catalogPriceRub: live?.price ?? null,
          displaySizes,
          displayName,
          displayPrice,
          displayImageUrl,
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
