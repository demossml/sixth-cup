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

/** Сдвиг безопасной области внутри листа (пиксели) — нужен для рамки выделения. */
export function safeBoxOffset(rect: { width: number }): { left: number; top: number } {
  return { left: (rect.width * SHEET_SAFE.x) / 100, top: (rect.width * SHEET_SAFE.top) / 100 }
}

/** Размер безопасной области по рамке листа на экране (для перетаскивания). */
export function safeBoxSize(rect: { width: number; height: number }): { w: number; h: number } {
  const padX = (rect.width * SHEET_SAFE.x) / 100
  const padTop = (rect.width * SHEET_SAFE.top) / 100
  const padBottom = (rect.width * SHEET_SAFE.bottom) / 100
  return { w: rect.width - padX * 2, h: rect.height - padTop - padBottom }
}

/**
 * Физические размеры листа. Ключ — id формата: у A4 и A5 почти одинаковая пропорция,
 * поэтому определять формат по ratio нельзя.
 */
const FORMAT_MM: Record<string, { width: number; height: number } | null> = {
  a4_portrait: { width: 210, height: 297 },
  a4_landscape: { width: 297, height: 210 },
  a5_portrait: { width: 148, height: 210 },
  a3_portrait: { width: 297, height: 420 },
  ratio_1_1: { width: 210, height: 210 },
  // Экран — пропорция, миллиметров у него нет.
  screen_16_9: null,
}

/** Размеры листа в миллиметрах по формату; `null` — формат без физического размера. */
export function sheetMm(format: string): { width: number; height: number } | null {
  return format in FORMAT_MM ? FORMAT_MM[format]! : FORMAT_MM.a4_portrait!
}

/** Безопасная область в мм: блоки живут в ней, проценты считаются от неё. */
export function safeMm(format: string): { width: number; height: number; left: number; top: number } | null {
  const sheet = sheetMm(format)
  if (!sheet) return null
  const left = (sheet.width * SHEET_SAFE.x) / 100
  const top = (sheet.width * SHEET_SAFE.top) / 100
  const bottom = (sheet.width * SHEET_SAFE.bottom) / 100
  return { width: sheet.width - left * 2, height: sheet.height - top - bottom, left, top }
}

/** Проценты блока → миллиметры от левого верхнего угла листа. */
export function pctToMm(
  rect: { xPct: number; yPct: number; wPct: number; hPct: number },
  format: string,
): { x: number; y: number; w: number; h: number } | null {
  const safe = safeMm(format)
  if (!safe) return null
  const round = (v: number) => Math.round(v * 10) / 10
  return {
    x: round(safe.left + (rect.xPct / 100) * safe.width),
    y: round(safe.top + (rect.yPct / 100) * safe.height),
    w: round((rect.wPct / 100) * safe.width),
    h: round((rect.hPct / 100) * safe.height),
  }
}

/** Миллиметры → проценты безопасной области (обратное к `pctToMm`). */
export function mmToPct(
  rect: { x: number; y: number; w: number; h: number },
  format: string,
): { xPct: number; yPct: number; wPct: number; hPct: number } | null {
  const safe = safeMm(format)
  if (!safe) return null
  return {
    xPct: ((rect.x - safe.left) / safe.width) * 100,
    yPct: ((rect.y - safe.top) / safe.height) * 100,
    wPct: (rect.w / safe.width) * 100,
    hPct: (rect.h / safe.height) * 100,
  }
}

