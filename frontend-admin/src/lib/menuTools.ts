/**
 * Инструменты раскладки: выравнивание, распределение, рамка выделения и зум «вписать».
 * Всё работает в процентах листа — тех же, что в документе и в PDF.
 */
import type { CatalogProduct, MenuBlock, Rect } from './menuLayout'
import { clampRect, MIN_H, MIN_W } from './menuLayout'

/**
 * Ключ позиции на листе: товары-варианты одного объёма — это одна позиция меню,
 * поэтому «Капучино 250 / 350 / 400» на листе считаются одним ключом группы.
 */
export const groupKeyOf = (p: Pick<CatalogProduct, 'id' | 'groupId'>): number => p.groupId ?? p.id

/**
 * Перестановка слоёв мышью: блок `dragId` встаёт на место `targetId`
 * (перед ним в списке сверху вниз) и всем блокам заново проставляются zIndex.
 */
export function reorderBlocks(blocks: MenuBlock[], dragId: string, targetId: string): MenuBlock[] {
  if (dragId === targetId) return blocks
  const top = [...blocks].sort((a, b) => b.zIndex - a.zIndex)
  const from = top.findIndex((b) => b.id === dragId)
  const to = top.findIndex((b) => b.id === targetId)
  if (from < 0 || to < 0) return blocks
  const moved = top.splice(from, 1)[0]!
  top.splice(to, 0, moved)
  const z = new Map(top.map((b, i) => [b.id, top.length - 1 - i]))
  return blocks.map((b) => {
    const next = z.get(b.id)
    return next === undefined || next === b.zIndex ? b : { ...b, zIndex: next }
  })
}

/** Шаг сетки и колонок: попадание в сетку важнее прилипания к соседям. */
export type GridSpec = { stepPct: number; cols: number }

/** Ближайшая линия сетки (шаг + правые границы колонок) для левого/верхнего края. */
export function snapToGrid(rect: Rect, grid: GridSpec): Rect {
  const step = grid.stepPct > 0 ? grid.stepPct : 0
  const colWidth = grid.cols > 1 ? 100 / grid.cols : 0
  const pick = (value: number): number => {
    let best = value
    let bestDist = Infinity
    const candidates = new Set<number>([0, 100])
    if (step > 0) {
      for (let v = 0; v <= 100 + 1e-9; v += step) candidates.add(Math.round(v * 1000) / 1000)
    }
    if (colWidth > 0) {
      for (let c = 0; c <= grid.cols; c += 1) candidates.add(Math.round(c * colWidth * 1000) / 1000)
    }
    for (const c of candidates) {
      const d = Math.abs(c - value)
      if (d < bestDist) {
        bestDist = d
        best = c
      }
    }
    return bestDist <= Math.max(0.5, step / 2) ? best : value
  }
  return clampRect({ ...rect, xPct: pick(rect.xPct), yPct: pick(rect.yPct) })
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

export function alignBlocks(blocks: MenuBlock[], ids: string[], mode: AlignMode): MenuBlock[] {
  const set = new Set(ids)
  const group = blocks.filter((b) => set.has(b.id) && !b.locked)
  if (group.length < 1) return blocks
  const left = Math.min(...group.map((b) => b.xPct))
  const right = Math.max(...group.map((b) => b.xPct + b.wPct))
  const top = Math.min(...group.map((b) => b.yPct))
  const bottom = Math.max(...group.map((b) => b.yPct + b.hPct))
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2
  return blocks.map((b) => {
    if (!set.has(b.id) || b.locked) return b
    switch (mode) {
      case 'left':
        return { ...b, xPct: left }
      case 'right':
        return { ...b, xPct: right - b.wPct }
      case 'center':
        return { ...b, xPct: cx - b.wPct / 2 }
      case 'top':
        return { ...b, yPct: top }
      case 'bottom':
        return { ...b, yPct: bottom - b.hPct }
      case 'middle':
        return { ...b, yPct: cy - b.hPct / 2 }
    }
  })
}

/** Равные промежутки между блоками по краям выделения (минимум три блока). */
export function distributeBlocks(blocks: MenuBlock[], ids: string[], axis: 'x' | 'y'): MenuBlock[] {
  const set = new Set(ids)
  const group = blocks.filter((b) => set.has(b.id) && !b.locked)
  if (group.length < 3) return blocks
  const size = (b: MenuBlock) => (axis === 'x' ? b.wPct : b.hPct)
  const pos = (b: MenuBlock) => (axis === 'x' ? b.xPct : b.yPct)
  const sorted = [...group].sort((a, b) => pos(a) - pos(b))
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const from = pos(first) + size(first)
  const to = pos(last)
  const total = to - from
  const sizes = sorted.slice(1, -1).reduce((sum, b) => sum + size(b), 0)
  const gaps = sorted.length - 1
  const gap = gaps > 0 ? (total - sizes) / gaps : 0
  const moved = new Map<string, number>()
  let cursor = from
  for (const b of sorted.slice(1, -1)) {
    cursor += gap
    moved.set(b.id, cursor)
    cursor += size(b)
  }
  return blocks.map((b) => {
    const v = moved.get(b.id)
    if (v == null) return b
    return axis === 'x' ? { ...b, xPct: v } : { ...b, yPct: v }
  })
}

/** Пересечение рамок — для выделения «рамкой». */
export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.xPct < b.xPct + b.wPct && a.xPct + a.wPct > b.xPct && a.yPct < b.yPct + b.hPct && a.yPct + a.hPct > b.yPct

/** Нормализует рамку, нарисованную мышью в любую сторону. */
export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): Rect {
  return clampRect({
    xPct: Math.min(x1, x2),
    yPct: Math.min(y1, y2),
    wPct: Math.max(MIN_W, Math.abs(x2 - x1)),
    hPct: Math.max(MIN_H, Math.abs(y2 - y1)),
  })
}

/** Масштаб «вписать лист целиком» с запасом на поля контейнера. */
export function fitZoom(containerW: number, containerH: number, ratio: number, baseWidth: number): number {
  if (!containerW || !containerH) return 1
  const byWidth = (containerW - 32) / baseWidth
  const byHeight = (containerH - 32) / (baseWidth / ratio)
  return Math.round(Math.min(byWidth, byHeight) * 100) / 100
}

export const clampZoom = (z: number): number => Math.min(4, Math.max(0.25, Math.round(z * 100) / 100))

/** Шаг зума кнопками: на мелком масштабе меньше, на крупном больше. */
export const zoomStep = (z: number, dir: 1 | -1): number => clampZoom(z + dir * (z < 0.5 ? 0.05 : z < 1.5 ? 0.1 : 0.25))

export type SnapGuides = { x: number[]; y: number[] }

/**
 * Прилипание с показом линий: возвращает рамку и координаты направляющих,
 * которые сработали (край листа, центр листа, край или центр соседнего блока).
 */
export function snapWithGuides(
  rect: Rect,
  others: Rect[],
  threshold = 0.8,
): { rect: Rect; guides: SnapGuides } {
  const near = (v: number, t: number) => Math.abs(v - t) <= threshold

  const xTargets: { at: number; pos: number }[] = [
    { at: 0, pos: 0 },
    { at: 50, pos: (100 - rect.wPct) / 2 },
    { at: 100, pos: 100 - rect.wPct },
  ]
  const yTargets: { at: number; pos: number }[] = [
    { at: 0, pos: 0 },
    { at: 50, pos: (100 - rect.hPct) / 2 },
    { at: 100, pos: 100 - rect.hPct },
  ]
  for (const o of others) {
    xTargets.push({ at: o.xPct + o.wPct / 2, pos: o.xPct + o.wPct / 2 - rect.wPct / 2 })
    xTargets.push({ at: o.xPct, pos: o.xPct })
    xTargets.push({ at: o.xPct + o.wPct, pos: o.xPct + o.wPct - rect.wPct })
    yTargets.push({ at: o.yPct + o.hPct / 2, pos: o.yPct + o.hPct / 2 - rect.hPct / 2 })
    yTargets.push({ at: o.yPct, pos: o.yPct })
    yTargets.push({ at: o.yPct + o.hPct, pos: o.yPct + o.hPct - rect.hPct })
  }

  const bestX = xTargets.filter((t) => near(rect.xPct, t.pos)).sort((a, b) => Math.abs(rect.xPct - a.pos) - Math.abs(rect.xPct - b.pos))[0]
  const bestY = yTargets.filter((t) => near(rect.yPct, t.pos)).sort((a, b) => Math.abs(rect.yPct - a.pos) - Math.abs(rect.yPct - b.pos))[0]

  const guides: SnapGuides = { x: [], y: [] }
  if (bestX) guides.x.push(bestX.at)
  if (bestY) guides.y.push(bestY.at)
  return {
    rect: clampRect({ ...rect, xPct: bestX ? bestX.pos : rect.xPct, yPct: bestY ? bestY.pos : rect.yPct }),
    guides,
  }
}

/**
 * Эффективное разрешение фото на печати: сколько dpi получится, если растянуть
 * картинку на всю рамку блока. Ниже 200 — на бумаге будет мыло.
 */
export function effectiveDpi(naturalWidthPx: number, blockWidthPct: number, sheetWidthMm: number): number {
  if (!naturalWidthPx || !blockWidthPct) return 0
  const widthMm = (sheetWidthMm * blockWidthPct) / 100
  if (widthMm <= 0) return 0
  return Math.round(naturalWidthPx / (widthMm / 25.4))
}

/** Ширина листа в мм по формату; для экранного формата считаем условные 297 мм. */
export function sheetWidthMm(ratio: number): number {
  if (Math.abs(ratio - 1) < 0.01) return 210
  if (Math.abs(ratio - 16 / 9) < 0.01) return 297
  if (Math.abs(ratio - 297 / 210) < 0.01) return 297
  return 210
}

/* ───────────── группы блоков ───────────── */

/** Id блоков, которые выделяются вместе с данным: вся его группа, иначе только он. */
export function groupSelectionIds(blocks: MenuBlock[], id: string): string[] {
  const block = blocks.find((b) => b.id === id)
  if (!block) return [id]
  if (!block.groupId) return [id]
  return blocks.filter((b) => b.groupId === block.groupId).map((b) => b.id)
}

let groupSeq = 0
const nextGroupId = (): string => `grp-${Date.now().toString(36)}-${(groupSeq += 1)}`

/** Назначает общий groupId выделенным блокам (минимум двум). Возвращает новый документ. */
export function groupBlocks(blocks: MenuBlock[], ids: string[]): { blocks: MenuBlock[]; groupId: string | null } {
  if (ids.length < 2) return { blocks, groupId: null }
  const gid = nextGroupId()
  return { blocks: blocks.map((b) => (ids.includes(b.id) ? { ...b, groupId: gid } : b)), groupId: gid }
}

export function ungroupBlocks(blocks: MenuBlock[], ids: string[]): MenuBlock[] {
  return blocks.map((b) => (ids.includes(b.id) ? { ...b, groupId: null } : b))
}

/* ───────────── авто-фит текста ───────────── */

/**
 * Подбор кегля: уменьшаем шагом 0.5 pt, пока текст не перестанет вылезать из рамки.
 * `fits` — внешняя проверка (в браузере — измерение скрытым блоком), поэтому функция
 * чистая и проверяется тестом без DOM.
 */
export function fitFontSize(
  fits: (pt: number) => boolean,
  startPt: number,
  minPt = 6,
  step = 0.5,
): number {
  let pt = Math.max(minPt, startPt)
  // Верхняя граница — 72 pt, как в схеме блока.
  pt = Math.min(72, pt)
  while (pt > minPt && !fits(pt)) pt = Math.round((pt - step) * 10) / 10
  return pt
}

/** Ширина листа на экране, от которой считаются проценты (совпадает с редактором). */
export const SHEET_PX = 560

/** Кегль в pt → px при ширине листа SHEET_PX (1 pt = 0.168 % ширины A4). */
export const ptToPx = (pt: number): number => (pt / 595.28) * 100 * (SHEET_PX / 100)

/**
 * Измерение в браузере: скрытый блок с теми же шрифтовыми настройками.
 * Возвращает проверку «помещается ли текст при таком кегле» и функцию уборки.
 */
export function domTextMeasurer(opts: {
  text: string
  widthPct: number
  heightPct: number
  fontFamily: string
  bold: boolean
  lineHeight: number
  tracking: number
  ratio: number
}): { fits: (pt: number) => boolean; cleanup: () => void } {
  if (typeof document === 'undefined') return { fits: () => true, cleanup: () => {} }
  const probe = document.createElement('div')
  probe.style.position = 'fixed'
  probe.style.left = '-10000px'
  probe.style.top = '0'
  probe.style.visibility = 'hidden'
  probe.style.whiteSpace = 'pre-wrap'
  probe.style.wordBreak = 'break-word'
  probe.style.overflow = 'hidden'
  probe.style.fontFamily = opts.fontFamily
  probe.style.fontWeight = opts.bold ? '650' : '400'
  probe.style.lineHeight = String(opts.lineHeight)
  probe.style.letterSpacing = `${opts.tracking / 1000}em`
  // Рамка как у блока: проценты считаются от безопасной области, а не от края листа
  // (поля 4.4 % по бокам и сверху, 6 % снизу — как в sheetGeometry).
  const sheetH = SHEET_PX / opts.ratio
  const safeW = SHEET_PX - 2 * (SHEET_PX * 0.044)
  const safeH = sheetH - SHEET_PX * 0.044 - SHEET_PX * 0.06
  probe.style.width = `${(opts.widthPct / 100) * safeW}px`
  probe.style.height = `${(opts.heightPct / 100) * safeH}px`
  probe.textContent = opts.text
  document.body.appendChild(probe)
  return {
    fits: (pt: number) => {
      probe.style.fontSize = `${ptToPx(pt)}px`
      return probe.scrollHeight <= probe.clientHeight + 0.5
    },
    cleanup: () => probe.remove(),
  }
}

/**
 * Раскладка выделенных блоков по колонкам: порядок — как читают (сверху вниз, слева направо),
 * ширина колонки — общая ширина выделения, промежуток фиксированный.
 */
export function layoutColumns(
  blocks: MenuBlock[],
  ids: string[],
  columns: 1 | 2 | 3,
  gapPct = 4,
): MenuBlock[] {
  const set = new Set(ids)
  const list = blocks.filter((b) => set.has(b.id) && !b.locked)
  if (list.length === 0) return blocks

  const totalW =
    Math.max(...list.map((b) => b.xPct + b.wPct)) - Math.min(...list.map((b) => b.xPct))
  const left = Math.min(...list.map((b) => b.xPct))
  const top = Math.min(...list.map((b) => b.yPct))
  const colW = Math.max(MIN_W, (totalW - gapPct * (columns - 1)) / columns)

  // Читаем как в книге: сверху вниз, при равенстве — слева направо.
  const ordered = [...list].sort((a, b) => a.yPct - b.yPct || a.xPct - b.xPct)
  const perColumn = Math.ceil(ordered.length / columns)

  const result = new Map<string, { xPct: number; yPct: number; wPct: number }>()
  for (let col = 0; col < columns; col++) {
    const column = ordered.slice(col * perColumn, (col + 1) * perColumn)
    let y = top
    for (const b of column) {
      result.set(b.id, { xPct: left + col * (colW + gapPct), yPct: y, wPct: colW })
      y += b.hPct + 1.2
    }
  }

  return blocks.map((b) => {
    const next = result.get(b.id)
    return next ? { ...b, ...clampRect({ ...next, hPct: b.hPct }) } : b
  })
}
