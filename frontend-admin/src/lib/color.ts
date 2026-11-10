/**
 * Цвет в редакторе макета: ввод в любом виде и предупреждение о контрасте.
 *
 * В документе цвет хранится как `#RRGGBB` или `#RRGGBBAA` — так его понимают и CSS,
 * и серверный PDF (там альфа превращается в смешение с бумагой или в opacity).
 */

export type Rgba = { r: number; g: number; b: number; a: number }

const clamp255 = (v: number): number => Math.min(255, Math.max(0, Math.round(v)))

/** Любая запись → rgba. Понимает `#abc`, `#aabbcc`, `#aabbccdd`, `rgb(…)`, `rgba(…)`. */
export function parseColor(input: string | null | undefined): Rgba | null {
  const s = (input ?? '').trim().toLowerCase()
  if (!s) return null
  const hex = s.startsWith('#') ? s.slice(1) : s
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[0]! + hex[0]!, 16),
      g: parseInt(hex[1]! + hex[1]!, 16),
      b: parseInt(hex[2]! + hex[2]!, 16),
      a: 1,
    }
  }
  if (/^[0-9a-f]{6}$/.test(hex) || /^[0-9a-f]{8}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    }
  }
  const rgb = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/)
  if (rgb) {
    return {
      r: clamp255(Number(rgb[1])),
      g: clamp255(Number(rgb[2])),
      b: clamp255(Number(rgb[3])),
      a: rgb[4] == null ? 1 : Math.min(1, Math.max(0, Number(rgb[4]))),
    }
  }
  return null
}

const hx = (n: number): string => clamp255(n).toString(16).padStart(2, '0').toUpperCase()

/** rgba → `#RRGGBB` или `#RRGGBBAA` (альфа только когда она не 100 %). */
export function formatColor(c: Rgba): string {
  const base = `#${hx(c.r)}${hx(c.g)}${hx(c.b)}`
  return c.a >= 0.999 ? base : `${base}${hx(c.a * 255)}`
}

/** Безопасно нормализует ввод пользователя; null — «это не цвет». */
export function normalizeHex(input: string): string | null {
  const c = parseColor(input)
  return c ? formatColor(c) : null
}

export const alphaOf = (color: string): number => parseColor(color)?.a ?? 1

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color)
  if (!c) return color
  return formatColor({ ...c, a: Math.min(1, Math.max(0, alpha)) })
}

/** Насыщенность цвета на белой бумаге: так печать понимает полупрозрачный фон. */
export function overWhite(color: string): string {
  const c = parseColor(color)
  if (!c) return color
  if (c.a >= 0.999) return formatColor({ ...c, a: 1 })
  const mix = (v: number) => Math.round(v * c.a + 255 * (1 - c.a))
  return formatColor({ r: mix(c.r), g: mix(c.g), b: mix(c.b), a: 1 })
}

const channel = (v: number): number => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(color: string): number {
  const c = parseColor(color)
  if (!c) return 0
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

/** Полупрозрачный передний план смешиваем с фоном: так его и увидит человек. */
export function blendOver(fg: string, bg: string): string {
  const f = parseColor(fg)
  const b = parseColor(bg)
  if (!f || !b) return fg
  const mix = (x: number, y: number) => Math.round(x * f.a + y * (1 - f.a))
  return formatColor({ r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b), a: 1 })
}

/** Контраст по WCAG 2.1: 1…21. Пары ниже 4.5 — не AA для обычного текста. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(blendOver(a, b))
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

export type ContrastVerdict = { ratio: number; level: 'AAA' | 'AA' | 'AA-large' | 'fail' }

export function contrastVerdict(ratio: number): ContrastVerdict {
  if (ratio >= 7) return { ratio, level: 'AAA' }
  if (ratio >= 4.5) return { ratio, level: 'AA' }
  if (ratio >= 3) return { ratio, level: 'AA-large' }
  return { ratio, level: 'fail' }
}

export const CONTRAST_LABEL: Record<ContrastVerdict['level'], string> = {
  AAA: 'AAA',
  AA: 'AA',
  'AA-large': 'только крупный текст',
  fail: 'ниже AA',
}
