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
