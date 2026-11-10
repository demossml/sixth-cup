/**
 * Спуск полос (P2-10): несколько страниц макета на одном печатном листе.
 *
 * Типография не любит, когда ей присылают по одному листу: проще печатать
 * 2 или 4 страницы на A3/A2 и резать. Здесь — только арифметика раскладки:
 * размер листа, сетка, общий масштаб и координаты каждой страницы.
 * Рендер PDF и метки реза используют этот план, поэтому он покрыт тестами.
 */

export type SheetId = 'a3' | 'a2'

export type ImposeSpec = {
  sheet: SheetId
  rows: number
  cols: number
}

export const MM_TO_PT = 72 / 25.4

/** Печатные листы, на которые имеет смысл спускать меню. */
export const SHEET_MM: Record<SheetId, { w: number; h: number; label: string }> = {
  a3: { w: 297, h: 420, label: 'A3' },
  a2: { w: 420, h: 594, label: 'A2' },
}

/** Готовые варианты спуска: лист + сетка. */
export const IMPOSE_PRESETS = [
  { id: 'off', label: 'Не спускать', spec: null },
  { id: 'a3-2', label: '2 на A3 (2×1)', spec: { sheet: 'a3', rows: 2, cols: 1 } as ImposeSpec },
  { id: 'a3-4', label: '4 на A3 (2×2)', spec: { sheet: 'a3', rows: 2, cols: 2 } as ImposeSpec },
  { id: 'a2-4', label: '4 на A2 (2×2)', spec: { sheet: 'a2', rows: 2, cols: 2 } as ImposeSpec },
] as const

export type ImposeCell = {
  /** Левый верхний угол содержимого, pt. */
  x: number
  y: number
  /** Габарит содержимого на листе, pt (уже с масштабом). */
  w: number
  h: number
  /** Какой странице документа соответствует ячейка (0-based). */
  page: number
}

export type ImposePlan = {
  sheet: SheetId
  /** Размер печатного листа, pt. */
  sheetW: number
  sheetH: number
  /** Лист повёрнут: сетка шире, чем выше. */
  landscape: boolean
  rows: number
  cols: number
  /** Общий масштаб страниц: одинаковый для всех, иначе листы будут разного размера. */
  scale: number
  /** Страницы повёрнуты на 90°: только так A4 влезает в A3 вдвое. */
  rotated: boolean
  cells: ImposeCell[]
  /** Поля листа и промежуток между страницами, pt. */
  margin: number
  gap: number
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/**
 * План спуска: сетка `rows × cols` на листе `sheet`.
 *
 * Ориентация листа и поворот страниц выбираются так, чтобы страницы были
 * крупнее — это единственное, что важно типографии. Например A4 на A3 даёт
 * 2 страницы только с поворотом на 90°.
 */
export function imposePlan(
  pageW: number,
  pageH: number,
  spec: ImposeSpec,
  opts: { marginMm?: number; gapMm?: number } = {},
): ImposePlan {
  const margin = Math.max(0, opts.marginMm ?? 8) * MM_TO_PT
  const gap = Math.max(0, opts.gapMm ?? 3) * MM_TO_PT
  const rows = clamp(Math.round(spec.rows), 1, 4)
  const cols = clamp(Math.round(spec.cols), 1, 4)
  const sheetMm = SHEET_MM[spec.sheet] ?? SHEET_MM.a3

  let best: ImposePlan | null = null
  for (const landscape of [false, true]) {
    const sheetW = (landscape ? sheetMm.h : sheetMm.w) * MM_TO_PT
    const sheetH = (landscape ? sheetMm.w : sheetMm.h) * MM_TO_PT
    const usableW = sheetW - margin * 2
    const usableH = sheetH - margin * 2
    const cellW = (usableW - gap * (cols - 1)) / cols
    const cellH = (usableH - gap * (rows - 1)) / rows
    if (cellW <= 0 || cellH <= 0) continue

    for (const rotated of [false, true]) {
      // Поворот меняет соотношение сторон страницы: A4 portrait → 297×210.
      const contentW = rotated ? pageH : pageW
      const contentH = rotated ? pageW : pageH
      const scale = Math.min(cellW / contentW, cellH / contentH)
      if (scale <= 0) continue
      const plan: ImposePlan = {
        sheet: spec.sheet,
        sheetW,
        sheetH,
        landscape,
        rows,
        cols,
        scale,
        rotated,
        cells: [],
        margin,
        gap,
      }
      plan.cells = layoutCells(plan, contentW * scale, contentH * scale)
      if (!best || plan.scale > best.scale + 1e-6) best = plan
    }
  }

  // Страховка: если что-то не сошлось, отдаём минимальный валидный план.
  return (
    best ?? {
      sheet: spec.sheet,
      sheetW: sheetMm.w * MM_TO_PT,
      sheetH: sheetMm.h * MM_TO_PT,
      landscape: false,
      rows,
      cols,
      scale: Math.min((sheetMm.w * MM_TO_PT) / (pageW * cols), (sheetMm.h * MM_TO_PT) / (pageH * rows)),
      rotated: false,
      cells: [],
      margin,
      gap,
    }
  )
}

/** Координаты страниц: слева направо, сверху вниз, каждая по центру своей ячейки. */
function layoutCells(plan: ImposePlan, contentW: number, contentH: number): ImposeCell[] {
  const usableW = plan.sheetW - plan.margin * 2
  const usableH = plan.sheetH - plan.margin * 2
  const cellW = (usableW - plan.gap * (plan.cols - 1)) / plan.cols
  const cellH = (usableH - plan.gap * (plan.rows - 1)) / plan.rows
  const cells: ImposeCell[] = []
  let page = 0
  for (let r = 0; r < plan.rows; r += 1) {
    for (let c = 0; c < plan.cols; c += 1) {
      const cellX = plan.margin + c * (cellW + plan.gap)
      const cellY = plan.margin + r * (cellH + plan.gap)
      cells.push({
        x: cellX + (cellW - contentW) / 2,
        y: cellY + (cellH - contentH) / 2,
        w: contentW,
        h: contentH,
        page: page++,
      })
    }
  }
  return cells
}

/** Сколько печатных листов нужно на N страниц документа. */
export function sheetCount(pages: number, rows: number, cols: number): number {
  const perSheet = Math.max(1, rows * cols)
  return Math.max(1, Math.ceil(pages / perSheet))
}

/** Подпись для интерфейса: «A3 · 2×2 · A4 → 70 %». */
export function imposeLabel(plan: ImposePlan, pageMm: string): string {
  const size = `${SHEET_MM[plan.sheet].label}${plan.landscape ? ' альбом' : ''}`
  const scale = `${Math.round(plan.scale * 100)} %`
  const rotate = plan.rotated ? ' · страницы повёрнуты' : ''
  return `${size} · ${plan.rows}×${plan.cols} · ${pageMm} → ${scale}${rotate}`
}

/** Разбор строки из query: `a3-2`, `a2-4`. Неизвестное значение — без спуска. */
export function parseImpose(raw: string | undefined | null): ImposeSpec | null {
  if (!raw) return null
  const preset = IMPOSE_PRESETS.find((p) => p.id === raw)
  return preset?.spec ? { ...preset.spec } : null
}
