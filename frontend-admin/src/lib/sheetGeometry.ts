/**
 * Геометрия листа на клиенте — зеркало `backend/src/modules/admin/sheetGeometry.ts`.
 *
 * Поля — доли ширины листа; блоки живут внутри безопасной области (`.mc-safe`),
 * поэтому проценты в `doc_json` означают одно и то же в редакторе и в PDF.
 * В CSS те же числа заданы в `cqw` (1 cqw = 1 % ширины листа).
 */
export const SHEET_SAFE = { x: 4.4, top: 4.4, bottom: 6 } as const

/** Инлайн-стиль безопасной области: та же рамка, что `contentBox` в PDF. */
export const safeAreaStyle = {
  position: 'absolute',
  left: `${SHEET_SAFE.x}cqw`,
  right: `${SHEET_SAFE.x}cqw`,
  top: `${SHEET_SAFE.top}cqw`,
  bottom: `${SHEET_SAFE.bottom}cqw`,
} as const

/**
 * Кегль в pt → процент ширины листа (1 pt на A4 = 0.168 %).
 * В PDF кегль масштабируется вместе с листом, поэтому доля ширины одна для всех форматов.
 */
export const ptToWidthPct = (pt: number): number => (pt / 595.28) * 100

/** Размер безопасной области по рамке листа на экране (для перетаскивания). */
export function safeBoxSize(rect: { width: number; height: number }): { w: number; h: number } {
  const padX = (rect.width * SHEET_SAFE.x) / 100
  const padTop = (rect.width * SHEET_SAFE.top) / 100
  const padBottom = (rect.width * SHEET_SAFE.bottom) / 100
  return { w: rect.width - padX * 2, h: rect.height - padTop - padBottom }
}
