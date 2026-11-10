/**
 * Геометрия листа макета — единственное место, где заданы поля.
 *
 * Раньше превью и печать расходились: холст позиционировал блоки от края листа
 * (абсолютные % считаются от padding box), а PDF — от `pad + x% * cbW`.
 * Теперь правило одно: блоки живут в «безопасной области», поля — доли ширины листа.
 * Те же числа использует клиент (`frontend-admin/src/lib/sheetGeometry.ts`).
 */

/** Поля безопасной области как доли ширины листа (не высоты — так масштаб одинаков для A4/A3/16:9). */
export const SHEET_SAFE = { x: 0.044, top: 0.044, bottom: 0.06 } as const

export type SheetBox = { x: number; y: number; w: number; h: number }

/** Область, в которой стоят блоки: в pt от левого-верхнего угла листа. */
export function contentBox(width: number, height: number, bleed = 0): SheetBox {
  const padX = width * SHEET_SAFE.x + bleed
  const padTop = width * SHEET_SAFE.top + bleed
  const padBottom = width * SHEET_SAFE.bottom + bleed
  return { x: padX, y: padTop, w: width - padX * 2, h: height - padTop - padBottom }
}

/** Точка в pt для блока с координатами в процентах безопасной области. */
export function placeBlock(box: SheetBox, rect: { xPct: number; yPct: number; wPct: number; hPct: number }): SheetBox {
  return {
    x: box.x + (rect.xPct / 100) * box.w,
    y: box.y + (rect.yPct / 100) * box.h,
    w: (rect.wPct / 100) * box.w,
    h: (rect.hPct / 100) * box.h,
  }
}

/** Подвал листа: внутри нижнего поля, на 62 % его высоты от низа листа. */
export function footerBaselineY(height: number, width: number, bleed = 0): number {
  const padBottom = width * SHEET_SAFE.bottom + bleed
  return height - padBottom * 0.62
}
