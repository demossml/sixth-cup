/**
 * Движок раскладки секций в блоки-координаты (аудит, задача 2.2 / ML-13).
 *
 * Секции — семантический слой: «Кофе → Капучино 250/350/450». Раскладка превращает их в обычные
 * блоки холста (проценты от безопасной области), те же, что рисует редактор и PDF. Функция чистая:
 * одинаковый вход даёт одинаковый лист, поэтому её можно вызывать и на сервере, и в тестах.
 */
import type { MenuBlock, MenuDoc, MenuPage, MenuSection } from './menuLayoutDoc'

export type FlowOptions = {
  /** Колонки текста: 1 — крупные позиции, 2 — компактный лист. */
  columns?: 1 | 2
  /** Отступ от закреплённых блоков сверху, %. */
  top?: number
  /** Высота заголовка секции, %. */
  sectionHeight?: number
  /** Высота позиции без объёмов и с объёмами, %. */
  itemHeight?: number
  itemHeightWithSizes?: number
  gap?: number
  maxPages?: number
}

const DEFAULTS: Required<FlowOptions> = {
  columns: 2,
  top: 22,
  sectionHeight: 5.5,
  itemHeight: 5,
  itemHeightWithSizes: 7,
  gap: 5,
  maxPages: 12,
}

/** Блоки, которые поставил человек: раскладка их не двигает и не удаляет. */
export const isPinned = (b: MenuBlock): boolean =>
  b.pinned === true || b.type === 'logo' || b.type === 'text' || b.type === 'image' || b.type === 'divider'

export type FlowInput = {
  sections: MenuSection[]
  pinned?: MenuBlock[]
  options?: FlowOptions
}

export type FlowResult = { pages: MenuPage[]; dropped: number }

/**
 * Разложить секции по страницам. Закреплённые блоки остаются на первой странице,
 * новые позиции идут ниже них и переносятся на следующую страницу, когда кончается место.
 */
export function flowSections({ sections, pinned, options }: FlowInput): FlowResult {
  const opts = { ...DEFAULTS, ...(options ?? {}) }
  const keep = pinned ?? []
  const firstPage = keep.length ? Math.max(opts.top, Math.ceil(Math.max(...keep.map((b) => b.yPct + b.hPct)) + 2)) : opts.top
  const colW = (100 - (opts.columns - 1) * opts.gap) / opts.columns
  const colX = (i: number) => i * (colW + opts.gap)

  const pages: MenuPage[] = [{ id: 'page-1', blocks: keep.map((b) => ({ ...b, pinned: true })) }]
  let page = pages[0]!
  let col = 0
  let y = firstPage
  let dropped = 0
  let seq = 0
  let pageNo = 1

  const nextPage = () => {
    pageNo += 1
    page = { id: `page-${pageNo}`, blocks: [] }
    pages.push(page)
    col = 0
    y = /* новая страница начинается сверху, без заголовка листа */ 0
  }

  const place = (block: MenuBlock) => {
    block.zIndex = page.blocks.length
    block.sortOrder = seq++
    page.blocks.push(block)
  }

  const ensureRoom = (h: number) => {
    if (y + h <= 100) return true
    if (col < opts.columns - 1) {
      col += 1
      y = page === pages[0] ? firstPage : 0
      return y + h <= 100
    }
    if (pages.length >= opts.maxPages) return false
    nextPage()
    return true
  }

  const sectionBlock = (section: MenuSection, continued = false): MenuBlock => ({
    id: `cat-${section.id}${continued ? '-p' : ''}`,
    type: 'category',
    xPct: colX(col),
    yPct: 0,
    wPct: colW,
    hPct: opts.sectionHeight - 1.5,
    zIndex: 0,
    rotationDeg: 0,
    hidden: false,
    productId: null,
    categoryId: section.categoryId,
    titleOverride: continued ? `${section.title} (продолжение)` : section.title,
    priceRubOverride: null,
    priceText: null,
    showPhoto: false,
    photoUrlOverride: null,
    badge: null,
    text: null,
    url: null,
    fit: 'cover',
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
    itemId: null,
    pinned: false,
  })

  for (const section of sections) {
    const items = section.items.filter((it) => !it.hidden)
    if (items.length === 0) continue
    if (!ensureRoom(opts.sectionHeight)) break

    // Заголовок нужен в начале секции и ещё раз после переноса на следующую колонку/страницу.
    let headerAt: { page: MenuPage | null; col: number } = { page: null, col: -1 }
    const putHeader = (continued: boolean) => {
      const header = sectionBlock(section, continued)
      header.yPct = Math.max(0, Math.min(100 - header.hPct, y))
      place(header)
      y += opts.sectionHeight
      headerAt = { page, col }
    }
    putHeader(false)

    let placedAny = false
    for (const item of items) {
      const h = item.sizes.length > 1 ? opts.itemHeightWithSizes : opts.itemHeight
      if (!ensureRoom(h)) {
        dropped += 1
        continue
      }
      const moved = headerAt.page !== page || headerAt.col !== col
      if (moved && !ensureRoom(opts.sectionHeight)) {
        dropped += 1
        continue
      }
      if (moved) putHeader(true)
      placedAny = true
      const block: MenuBlock = {
        ...sectionBlock(section, false),
        id: `p-${item.id}`,
        type: 'product',
        xPct: colX(col),
        yPct: Math.max(0, Math.min(100 - h, y)),
        wPct: colW,
        hPct: h,
        categoryId: section.categoryId,
        productId: item.productId,
        titleOverride: item.titleOverride,
        showPhoto: item.showPhoto && section.style.showPhotos,
        photoUrlOverride: item.photoUrlOverride,
        badge: item.badge,
        itemId: item.id,
      }
      place(block)
      y += h + 0.6
    }
    if (!placedAny) {
      // заголовок без позиций не нужен
      page.blocks = page.blocks.filter((b) => b.type !== 'category' || b.id !== `cat-${section.id}`)
      y -= opts.sectionHeight
    }
  }

  return { pages: pages.filter((p) => p.blocks.length > 0 || p === pages[0]), dropped }
}

/** Пересобрать документ: закреплённые блоки сохраняются, каталог раскладывается заново. */
export function relayoutDoc(doc: MenuDoc, options?: FlowOptions): { doc: MenuDoc; dropped: number } {
  const pinned = doc.pages.flatMap((p) => p.blocks).filter(isPinned)
  const sections = doc.pages.flatMap((p) => p.sections ?? [])
  const { pages, dropped } = flowSections({ sections, pinned, options })
  const first = doc.pages[0]
  if (first?.sections || sections.length) {
    pages[0] = { ...pages[0]!, sections }
  }
  return { doc: { ...doc, schemaVersion: 2, pages }, dropped }
}
