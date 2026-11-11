/**
 * P3-3: проверка печатаемости листа.
 *
 * Шрифт мельче 7 pt ловится в resolveDoc (по блокам). Здесь — то, что видно только
 * на печати: плотность фото (dpi) и контраст текста к фону листа.
 *
 * Замечания не блокируют экспорт (код `notice`): типография всё равно попросит
 * правку, но решение остаётся за человеком.
 */
import { closeSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../../config'
import { formatMetrics, isUploadsUrl, type LayoutFormat, type MenuTheme, type ResolvedDoc } from './menuLayoutDoc'

export type PrintBlocker = { blockId: string; pageId: string; code: string; text: string }

/** Минимальная плотность фото на печати: ниже — видно пиксели. */
export const MIN_PRINT_DPI = 200
/** Порог контраста: обычный текст — AA, крупный — AA для крупного текста. */
const CONTRAST_NORMAL = 4.5
const CONTRAST_LARGE = 3

// ── размер картинки из заголовка файла ──────────────────────────────
// sharp не годится: resolveDoc синхронный, а metadata() возвращает промис.
// Читаем первые 64 КБ и разбираем заголовок — этого хватает PNG/JPEG/WebP.

const cache = new Map<string, { w: number; h: number } | null>()

/** Размер по первым байтам файла. null — формат не распознан. */
export function parseImageSize(buf: Buffer): { w: number; h: number } | null {
  // PNG: сигнатура + IHDR (ширина/высота сразу после длины и типа чанка).
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)
    return w > 0 && h > 0 ? { w, h } : null
  }
  // JPEG: идём по сегментам до кадра (SOF0…SOF15, кроме DHT/JPG/DAC).
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]!
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      const len = buf.readUInt16BE(i + 2)
      const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
      if (isSof) {
        const h = buf.readUInt16BE(i + 5)
        const w = buf.readUInt16BE(i + 7)
        return w > 0 && h > 0 ? { w, h } : null
      }
      if (len < 2) return null
      i += 2 + len
    }
    return null
  }
  // WebP: RIFF/WEBP + один из трёх вариантов кадра.
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16)
    if (kind === 'VP8X') {
      const w = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16))
      const h = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16))
      return { w, h }
    }
    if (kind === 'VP8 ') {
      const w = buf.readUInt16LE(26) & 0x3fff
      const h = buf.readUInt16LE(28) & 0x3fff
      return w > 0 && h > 0 ? { w, h } : null
    }
    if (kind === 'VP8L') {
      const bits = buf.readUInt32LE(21)
      const w = (bits & 0x3fff) + 1
      const h = ((bits >> 14) & 0x3fff) + 1
      return { w, h }
    }
  }
  return null
}

/** Размер картинки из uploads (с кэшем): нужен для расчёта dpi. */
export function uploadsImageSize(url: string | null | undefined): { w: number; h: number } | null {
  if (!isUploadsUrl(url)) return null
  const file = url!.split('?')[0]!.slice('/uploads/'.length)
  if (!/^[A-Za-z0-9._-]+$/.test(file)) return null
  if (cache.has(file)) return cache.get(file)!
  let out: { w: number; h: number } | null = null
  try {
    const fd = openSync(join(config.uploadsDir, file), 'r')
    try {
      const buf = Buffer.alloc(65536)
      const read = readSync(fd, buf, 0, buf.length, 0)
      out = parseImageSize(buf.subarray(0, read))
    } finally {
      closeSync(fd)
    }
  } catch {
    out = null
  }
  cache.set(file, out)
  return out
}

/** Сброс кэша размеров: тесты и смена файлов под тем же именем. */
export function clearImageSizeCache(): void {
  cache.clear()
}

// ── контраст ────────────────────────────────────────────────────────

const parseHex = (color: string): { r: number; g: number; b: number } | null => {
  const hex = color.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return null
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
}

const channel = (v: number): number => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export const contrastRatio = (a: string, b: string): number => {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return 21
  const la = 0.2126 * channel(ca.r) + 0.7152 * channel(ca.g) + 0.0722 * channel(ca.b)
  const lb = 0.2126 * channel(cb.r) + 0.7152 * channel(cb.g) + 0.0722 * channel(cb.b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

/** Крупный текст по WCAG: ≥ 14 pt жирный или ≥ 18 pt обычный. */
const isLargeText = (fontSizePt: number, bold: boolean): boolean =>
  fontSizePt >= 18 || (bold && fontSizePt >= 14)

/** Фон листа для расчёта: градиент начинается сверху, там обычно и текст. */
const sheetBackground = (theme: MenuTheme): string =>
  theme.gradient?.from && parseHex(theme.gradient.from) ? theme.gradient.from : theme.bg

type PrintableBlock = {
  id: string
  type: string
  xPct: number
  yPct: number
  wPct: number
  hPct: number
  fontSizePt: number
  bold: boolean
  fit?: string
  url?: string | null
  displayImageUrl?: string | null
  showPhoto?: boolean
}

/** Плотность фото при печати: считаем по «сжатому» измерению (cover обрезает край). */
function photoDpi(block: PrintableBlock, url: string, format: LayoutFormat): number | null {
  const size = uploadsImageSize(url)
  if (!size) return null
  const sheet = formatMetrics(format)
  // formatMetrics отдаёт пункты: для dpi нужны миллиметры.
  const PT_TO_MM = 25.4 / 72
  const printedWmm = (block.wPct / 100) * sheet.width * PT_TO_MM
  const printedHmm = (block.hPct / 100) * sheet.height * PT_TO_MM
  if (printedWmm <= 0 || printedHmm <= 0) return null
  const mmPerPxX = printedWmm / size.w
  const mmPerPxY = printedHmm / size.h
  // Блок заполняется по большей стороне: реальная плотность — по ней.
  const mmPerPx = block.fit === 'contain' ? Math.max(mmPerPxX, mmPerPxY) : Math.min(mmPerPxX, mmPerPxY)
  if (!(mmPerPx > 0)) return null
  return Math.round(25.4 / mmPerPx)
}

/**
 * Все проверки печатаемости сразу: dpi фото и контраст текста.
 * Кегль < 7 pt приходит из resolveDoc — здесь его не дублируем.
 */
export function printChecks(resolved: ResolvedDoc, theme: MenuTheme, format: LayoutFormat): PrintBlocker[] {
  const out: PrintBlocker[] = []
  const bg = sheetBackground(theme)
  for (const page of resolved.pages) {
    for (const raw of page.blocks as unknown as PrintableBlock[]) {
      const photoUrl = raw.type === 'image' ? raw.url : raw.showPhoto ? raw.displayImageUrl : null
      if (photoUrl) {
        const dpi = photoDpi(raw, photoUrl, format)
        if (dpi != null && dpi < MIN_PRINT_DPI) {
          out.push({
            blockId: raw.id,
            pageId: page.id,
            code: 'low_dpi',
            text: `фото ${dpi} dpi — меньше ${MIN_PRINT_DPI}, на печати будет мылом`,
          })
        }
      }
      const textual = raw.type === 'product' || raw.type === 'category' || raw.type === 'text' || raw.type === 'header'
      if (textual) {
        const ratio = contrastRatio(theme.text, bg)
        const need = isLargeText(raw.fontSizePt, raw.bold) ? CONTRAST_LARGE : CONTRAST_NORMAL
        if (ratio < need) {
          out.push({
            blockId: raw.id,
            pageId: page.id,
            code: 'low_contrast',
            text: `контраст ${ratio}:1 — меньше ${need}:1, текст плохо читается`,
          })
        }
      }
    }
  }
  return out
}
