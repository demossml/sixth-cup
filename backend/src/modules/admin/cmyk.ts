/**
 * CMYK для типографии: PDF с DeviceCMYK-цветами прямо из рендера.
 *
 * Ghostscript на сервере может отсутствовать, а типографии просят CMYK для
 * текста и плашек (иначе rich black и «цвет поплыл»). Здесь — простая
 * конверсия без ICC-профиля: файл честно называется «Device CMYK».
 * Фотографии остаются RGB, их всё равно конвертирует печатная машина.
 */

export type Cmyk = [number, number, number, number]

/** HEX (#RRGGBB или #RRGGBBAA) → CMYK, значения 0…100. Альфа игнорируется. */
export function rgbToCmyk(hex: string): Cmyk {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255 || 0
  const g = parseInt(clean.slice(2, 4), 16) / 255 || 0
  const b = parseInt(clean.slice(4, 6), 16) / 255 || 0
  const k = 1 - Math.max(r, g, b)
  if (k >= 0.999) return [0, 0, 0, 100]
  const c = (1 - r - k) / (1 - k)
  const m = (1 - g - k) / (1 - k)
  const y = (1 - b - k) / (1 - k)
  const pct = (v: number) => Math.round(v * 1000) / 10
  return [pct(c), pct(m), pct(y), pct(k)]
}

/** Насколько «грязный» чёрный: для обычного текста лучше 0/0/0/100, а не смесь. */
export const isNearBlack = (hex: string): boolean => {
  const [c, m, y, k] = rgbToCmyk(hex)
  return k > 90 && c < 10 && m < 10 && y < 10
}
