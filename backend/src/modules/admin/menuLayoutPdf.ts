/**
 * PDF макета меню: холст по координатам, векторный текст (ToUnicode), брендовые шрифты.
 *
 * Каждый блок рисуется в своей рамке xPct/yPct/wPct/hPct — то же, что видно в редакторе.
 * Никакой «потоковой» раскладки здесь нет: превью и печать совпадают по определению.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../../config'
import { db } from '../../db'
import { formatMetrics, type RenderBlock } from './menuLayoutDoc'
import { contentBox, footerBaselineY, placeBlock } from './sheetGeometry'
import { typograph } from './typography'
import { rgbToCmyk } from './cmyk'
import type { LayoutView } from './menuLayouts'

const require = createRequire(import.meta.url)
type PdfDoc = any

/**
 * Шрифты лежат в `backend/assets/fonts`. После сборки бандл может оказаться на другой
 * глубине (`dist/index.js`), поэтому ищем каталог по списку кандидатов, а не по одному пути.
 */
function resolveFontDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '../../../assets/fonts'),
    resolve(here, '../../assets/fonts'),
    resolve(here, '../assets/fonts'),
    resolve(process.cwd(), 'backend/assets/fonts'),
    resolve(process.cwd(), 'assets/fonts'),
  ]
  return candidates.find((dir) => existsSync(join(dir, 'GolosText-400.ttf'))) ?? candidates[0]!
}

const FONT_DIR = resolveFontDir()

/** Файлы шрифтов по семейству: TTF для старых, WOFF для новых (fontkit читает оба). */
export const FONT_FILES: Record<string, { regular: string; bold: string }> = {
  Unbounded: { regular: 'Unbounded-400.ttf', bold: 'Unbounded-600.ttf' },
  'Golos Text': { regular: 'GolosText-400.ttf', bold: 'GolosText-600.ttf' },
  Manrope: { regular: 'manrope-400.woff', bold: 'manrope-700.woff' },
  Montserrat: { regular: 'montserrat-400.woff', bold: 'montserrat-700.woff' },
  Lora: { regular: 'lora-400.woff', bold: 'lora-700.woff' },
  'PT Serif': { regular: 'ptserif-400.woff', bold: 'ptserif-700.woff' },
  Oswald: { regular: 'oswald-400.woff', bold: 'oswald-600.woff' },
}

const FONTS = {
  body: join(FONT_DIR, 'GolosText-400.ttf'),
  bodyBold: join(FONT_DIR, 'GolosText-600.ttf'),
  display: join(FONT_DIR, 'Unbounded-400.ttf'),
  displayBold: join(FONT_DIR, 'Unbounded-600.ttf'),
}

/** Имя файла шрифта для семейства и начертания. Неизвестное семейство → Golos Text. */
function fontFile(family: string, bold: boolean): string {
  const files = FONT_FILES[family]
  if (files) return join(FONT_DIR, files[bold ? 'bold' : 'regular'])
  // Загруженный пользователем шрифт лежит в uploads: ищем по имени семейства.
  try {
    const row = db
      .prepare('SELECT regular_key AS regularKey, bold_key AS boldKey FROM menu_fonts WHERE family=?')
      .get(family) as { regularKey: string; boldKey: string | null } | undefined
    const key = row ? (bold ? row.boldKey ?? row.regularKey : row.regularKey) : null
    if (key) return join(config.uploadsDir, key)
  } catch {
    /* таблицы нет — печатаем встроенным шрифтом */
  }
  return join(FONT_DIR, FONT_FILES['Golos Text']![bold ? 'bold' : 'regular'])
}

export type PdfOptions = {
  preset: 'print' | 'screen'
  bleedMm: number
  /** Печатать цвета в DeviceCMYK — типографии часто просят именно так. */
  cmyk?: boolean
}

/** Цвет для PDF: строка RGB или массив CMYK. */
type Paint = string | number[]

const MM_TO_PT = 72 / 25.4

/** Длинное название не должно вылезать за рамку блока. */
function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…` : t
}

/**
 * Цвет может прийти с альфой (`#RRGGBBAA`) — в редакторе так задаётся прозрачность.
 * Печать без альфа-канала: фон листа смешиваем с бумагой, текст/акцент рисуем с opacity.
 */
export function splitHex(color: string): { hex: string; alpha: number } {
  const c = /^#[0-9a-f]{8}$/i.test(color) ? color : null
  if (!c) return { hex: color, alpha: 1 }
  return { hex: c.slice(0, 7), alpha: Math.round((parseInt(c.slice(7, 9), 16) / 255) * 100) / 100 }
}

/** Полупрозрачный фон листа на белой бумаге — это сплошной цвет, а не «прозрачный PDF». */
export function overWhite(color: string): string {
  const { hex, alpha } = splitHex(color)
  if (alpha >= 1) return hex
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `#${ch
    .map((v) => Math.round(v * alpha + 255 * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase()
}

/**
 * PDFKit принимает только JPEG/PNG. Фото из админки часто webp — конвертируем в PNG.
 * Ошибки глотаем: картинка не критична, блок нарисуется пустым.
 */
async function loadImage(url: string | null | undefined): Promise<Buffer | null> {
  const path = imagePathFor(url)
  if (!path) return null
  try {
    if (/\.(jpe?g|png)$/i.test(path)) return readFileSync(path)
    const sharp = (await import('sharp')).default
    return await sharp(path).png().toBuffer()
  } catch {
    return null
  }
}

/**
 * Кадрирование под рамку блока: считаем, какая часть исходника видна при `cover`
 * и заданном зуме, и вырезаем её через sharp. Иначе PDFKit рисует центр картинки,
 * и «фокус» на лице товара не совпадает с редактором.
 */
async function cropForBox(
  url: string | null | undefined,
  boxW: number,
  boxH: number,
  crop: { zoom: number; x: number; y: number } | null,
): Promise<Buffer | null> {
  if (!crop || boxW <= 0 || boxH <= 0) return null
  const path = imagePathFor(url)
  if (!path) return null
  try {
    const sharp = (await import('sharp')).default
    const img = sharp(path)
    const meta = await img.metadata()
    const sw = meta.width ?? 0
    const sh = meta.height ?? 0
    if (!sw || !sh) return null
    // При cover картинка масштабируется так, чтобы заполнить рамку целиком.
    const coverScale = Math.max(boxW / sw, boxH / sh)
    const visibleW = Math.min(sw, boxW / coverScale) / crop.zoom
    const visibleH = Math.min(sh, boxH / coverScale) / crop.zoom
    const left = Math.max(0, Math.min(sw - visibleW, crop.x * sw - visibleW / 2))
    const top = Math.max(0, Math.min(sh - visibleH, crop.y * sh - visibleH / 2))
    const dpi = 300 / 25.4
    return await sharp(path)
      .extract({ left: Math.round(left), top: Math.round(top), width: Math.max(1, Math.round(visibleW)), height: Math.max(1, Math.round(visibleH)) })
      .resize({ width: Math.max(1, Math.round(boxW * dpi)), withoutEnlargement: false })
      .png()
      .toBuffer()
  } catch {
    return null
  }
}

function imagePathFor(url: string | null | undefined): string | null {
  if (!url) return null
  const clean = url.split('?')[0]!
  if (clean.startsWith('/uploads/')) {
    const file = clean.slice('/uploads/'.length)
    if (!/^[a-zA-Z0-9._-]+$/.test(file)) return null
    const p = join(config.uploadsDir, file)
    return existsSync(p) ? p : null
  }
  return null
}

function drawBrand(doc: PdfDoc, x: number, y: number, size: number, color: Paint, accent: Paint) {
  doc.fillColor(color)
  doc.font('displayBold').fontSize(size)
  doc.text('6', x, y, { lineBreak: false })
  const w6 = doc.widthOfString('6')
  const dot = size * 0.19
  doc.rect(x + w6 + size * 0.04, y + size * 0.62, dot, dot).fill(accent)
  doc.fillColor(color)
  doc.text('7', x + w6 + size * 0.04 + dot + size * 0.04, y, { lineBreak: false })
  const w7 = doc.widthOfString('7')
  doc.font('body').fontSize(Math.max(4, size * 0.27)).fillColor(color)
  doc.text('coffee', x + w6 + w7 + dot + size * 0.24, y + size * 0.42, { lineBreak: false })
}

type Rect = { x: number; y: number; w: number; h: number }

/** Рисует один блок в его рамке. Ошибки картинок не валят экспорт — блок остаётся без фото. */
function drawBlock(
  doc: PdfDoc,
  block: RenderBlock,
  rect: Rect,
  ctx: {
    theme: LayoutView['theme']
    scale: number
    muted: string
    line: string
    imageFor: (url: string | null | undefined) => Buffer | null
    cropFor: (block: RenderBlock) => Buffer | null
    paint: (hex: string) => Paint
  },
) {
  const { theme, scale, muted, line, imageFor, paint } = ctx
  const { x, y, w, h } = rect

  switch (block.type) {
    case 'logo': {
      const size = Math.min(h * 0.9, 26 * scale)
      drawBrand(doc, x, y + Math.max(0, (h - size) / 2), size, paint(theme.text), paint(theme.accent))
      if (block.text) {
        doc.font('body').fontSize(Math.max(5, Math.min(8 * scale, h * 0.35))).fillColor(paint(muted))
        doc.text(block.text.toUpperCase(), x, y + h * 0.15, { width: w, align: 'right', lineBreak: false, ellipsis: true })
      }
      return
    }
    case 'text': {
      const size = Math.max(5, block.fontSizePt * scale)
      const raw = clip(block.text ?? block.titleOverride ?? '', 240)
      if (!raw) return
      const content = typograph(block.uppercase ? raw.toUpperCase() : raw)
      const ink = splitHex(theme.text)
      doc.font(block.bold ? 'displayBold' : 'body').fontSize(size).fillColor(paint(ink.hex)).fillOpacity(ink.alpha)
      doc.text(content, x, y, {
        width: w,
        height: h,
        align: block.align,
        ellipsis: true,
        lineGap: size * (block.lineHeight - 1),
        characterSpacing: (block.tracking / 1000) * size,
      })
      doc.fillOpacity(1)
      return
    }
    case 'category': {
      const name = clip(block.titleOverride ?? block.displayCategory ?? 'Категория', 48)
      const size = Math.max(6, Math.min(h * 0.62, 15 * scale))
      const ink = splitHex(theme.accent)
      doc.font(theme.fontHeading === 'Unbounded' ? 'displayBold' : 'bodyBold').fontSize(size).fillColor(paint(ink.hex)).fillOpacity(ink.alpha)
      doc.text(name, x, y, { width: w, height: h, lineBreak: false, ellipsis: true })
      doc.fillOpacity(1)
      doc.strokeColor(paint(line)).lineWidth(0.6).moveTo(x, y + h).lineTo(x + w, y + h).stroke()
      return
    }
    case 'divider': {
      doc.strokeColor(paint(block.warnings.length ? '#B4472C' : line)).lineWidth(1)
      doc.moveTo(x, y + h / 2).lineTo(x + w, y + h / 2).stroke()
      return
    }
    case 'image': {
      const src = ctx.cropFor(block) ?? imageFor(block.displayImageUrl ?? block.url)
      if (!src) {
        doc.strokeColor(paint(line)).lineWidth(0.8).rect(x, y, w, h).stroke()
        doc.font('body').fontSize(Math.max(5, 7 * scale)).fillColor(paint(muted))
        doc.text('фото', x + 4, y + h / 2 - 4, { width: w - 8, align: 'center' })
        return
      }
      try {
        if (block.fit === 'contain') doc.image(src, x, y, { fit: [w, h], align: 'center', valign: 'center' })
        else doc.image(src, x, y, { cover: [w, h], align: 'center', valign: 'center' })
      } catch {
        doc.strokeColor(line).lineWidth(0.8).rect(x, y, w, h).stroke()
      }
      return
    }
    default: {
      // product
      const thumbSrc = block.showPhoto ? ctx.cropFor(block) ?? imageFor(block.displayImageUrl) : null
      const thumb = thumbSrc ? Math.min(h, w * 0.35) : 0
      const padX = thumb ? thumb + 4 * scale : 0
      const contentW = w - padX
      if (thumb) {
        try {
          doc.image(thumbSrc!, x, y, { cover: [thumb, h] })
        } catch {
          /* без фото */
        }
      }
      const sizes = block.displaySizes ?? []
      // Позиция с объёмами занимает две строки: название, затем «250 · 350 · 450» и «169 · 219 · 269».
      // Порог по высоте — только чтобы вторая строка не наезжала; сами объёмы печатаем всегда.
      const twoLines = sizes.length > 1 && h > 10
      const nameSize = Math.max(5, Math.min(twoLines ? h * 0.3 : h * 0.42, 11 * scale))
      const price = block.displayPrice ?? '—'
      const name = typograph(
        block.uppercase
          ? clip(block.displayName ?? block.titleOverride ?? 'Позиция', 64).toUpperCase()
          : clip(block.displayName ?? block.titleOverride ?? 'Позиция', 64),
      )
      const tracking = (block.tracking / 1000) * nameSize
      doc.font('bodyBold').fontSize(nameSize).fillColor(paint(theme.text))
      doc.text(name, x + padX, y, {
        width: contentW - 40 * scale,
        height: h,
        lineBreak: false,
        ellipsis: true,
        lineGap: nameSize * (block.lineHeight - 1),
        characterSpacing: tracking,
      })
      doc.font('body').fontSize(nameSize).fillColor(paint(theme.text))
      if (!twoLines) doc.text(price, x + padX, y, { width: contentW, align: 'right', lineBreak: false })

      if (twoLines) {
        const sizeSize = Math.max(4, nameSize * 0.78)
        const labels = typograph(sizes.map((sz) => sz.label).join(' · '))
        const prices = typograph(sizes.map((sz) => sz.price).join(' · '))
        doc.font('body').fontSize(sizeSize).fillColor(paint(muted))
        doc.text(clip(labels, 64), x + padX, y + nameSize * (block.lineHeight + 0.35), {
          width: contentW,
          lineBreak: false,
          ellipsis: true,
          characterSpacing: (block.tracking / 1000) * sizeSize,
        })
        doc.fillColor(paint(theme.text))
        doc.text(clip(prices, 64), x + padX, y + nameSize * 1.5, {
          width: contentW,
          align: 'right',
          lineBreak: false,
          ellipsis: true,
        })
      }

      const sub = twoLines ? null : block.product?.variantLabel
      if (sub && h > nameSize * 2) {
        doc.font('body').fontSize(Math.max(4, nameSize * 0.72)).fillColor(paint(muted))
        doc.text(sub, x + padX, y + nameSize * 1.35, { width: contentW - 40 * scale, lineBreak: false, ellipsis: true })
      }
      if (block.badge && h > nameSize * 2.6) {
        doc.font('bodyBold').fontSize(Math.max(4, nameSize * 0.5)).fillColor(paint(theme.accent))
        doc.text(block.badge.toUpperCase(), x + padX, y + h - nameSize * 0.9, { width: contentW, lineBreak: false })
      }
      doc.strokeColor(paint(line)).lineWidth(0.4).dash(1, { space: 2 })
        .moveTo(x + padX, y + h).lineTo(x + w, y + h).stroke().undash()
    }
  }
}

/** Рендер всех страниц макета по координатам. Возвращает готовый PDF-буфер. */
export async function renderLayoutPdf(view: LayoutView, opts: PdfOptions): Promise<Buffer> {
  const PDFDocument = require('pdfkit') as new (o: Record<string, unknown>) => PdfDoc
  const metrics = formatMetrics(view.format)
  const theme = view.theme
  const bleed = Math.max(0, Math.min(10, opts.bleedMm)) * MM_TO_PT
  const scale = Math.max(0.6, Math.min(1.6, metrics.width / 595.28))

  const doc: PdfDoc = new PDFDocument({
    size: [metrics.width, metrics.height],
    margin: 0,
    autoFirstPage: false,
    info: {
      Title: view.title,
      Author: '6.7 Coffee',
      Subject: `Макет меню · ${metrics.label} ${metrics.mm}`,
      Creator: '6.7 Coffee admin',
    },
  })

  // Имена body/bodyBold/display/displayBold означают «шрифт темы»: так весь рендер
  // ниже автоматически печатает выбранными семействами, без ветвлений в каждом блоке.
  const cmyk = opts.cmyk === true
  /** Один и тот же цвет в RGB или CMYK — в зависимости от режима экспорта. */
  const paint = (hex: string): Paint => (cmyk ? rgbToCmyk(overWhite(hex)) : overWhite(hex))
  const registered = new Set<string>()
  doc.registerFont('body', fontFile(theme.fontBody, false))
  doc.registerFont('bodyBold', fontFile(theme.fontBody, true))
  doc.registerFont('display', fontFile(theme.fontHeading, false))
  doc.registerFont('displayBold', fontFile(theme.fontHeading, true))
  registered.add('theme')

  const W = metrics.width
  const H = metrics.height
  // Та же безопасная область, что у холста в редакторе: другой геометрии быть не должно.
  const box = contentBox(W, H, bleed)
  const padX = box.x
  const cbW = box.w
  const muted = theme.preset === 'dark' ? '#A5A39D' : theme.preset === 'season' ? '#76695B' : '#6E6A62'
  const line = theme.preset === 'dark' ? '#3B3F49' : theme.preset === 'season' ? '#D9C9B3' : '#D8D2C7'
  const pages = view.doc.pages

  const urls = new Set<string>()
  if (theme.backgroundImageUrl) urls.add(theme.backgroundImageUrl)
  for (const page of pages) {
    for (const block of page.blocks) {
      const url = block.type === 'image' ? block.displayImageUrl ?? block.url : block.type === 'product' ? block.displayImageUrl : null
      if (url) urls.add(url)
    }
  }
  const loaded = new Map<string, Buffer | null>()
  await Promise.all([...urls].map(async (url) => void loaded.set(url, await loadImage(url))))
  const imageFor = (url: string | null | undefined): Buffer | null => (url ? loaded.get(url) ?? null : null)

  // Кадрированные варианты считаем заранее: drawBlock синхронный.
  const cropped = new Map<string, Buffer | null>()
  await Promise.all(
    pages.flatMap((page) =>
      page.blocks
        .filter((b) => b.photoCrop)
        .map(async (b) => {
          const rect = placeBlock(box, b)
          const url = b.displayImageUrl ?? b.url
          cropped.set(b.id, await cropForBox(url, rect.w, rect.h, b.photoCrop))
        }),
    ),
  )
  const cropFor = (block: RenderBlock): Buffer | null => cropped.get(block.id) ?? null

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi]!
    doc.addPage({ size: [W, H], margin: 0 })
    // Фон: сплошной цвет или градиент. Альфа смешивается с бумагой, как и у сплошного цвета.
    if (theme.gradient) {
      const rad = ((theme.gradient.angle - 90) * Math.PI) / 180
      const cx = W / 2
      const cy = H / 2
      const len = Math.max(W, H)
      const grad = doc
        .linearGradient(cx - (Math.cos(rad) * len) / 2, cy - (Math.sin(rad) * len) / 2, cx + (Math.cos(rad) * len) / 2, cy + (Math.sin(rad) * len) / 2)
      grad.stop(0, overWhite(theme.gradient.from)).stop(1, overWhite(theme.gradient.to))
      doc.rect(0, 0, W, H).fill(grad)
    } else {
      doc.rect(0, 0, W, H).fill(paint(theme.bg))
    }

    const bg = imageFor(theme.backgroundImageUrl)
    if (bg) {
      try {
        doc.save()
        doc.image(bg, 0, 0, { cover: [W, H] })
        if (theme.backgroundDim > 0) {
          doc.opacity(theme.backgroundDim / 100)
          doc.rect(0, 0, W, H).fill('#000000')
          doc.opacity(1)
        }
        doc.restore()
      } catch {
        /* фон не критичен */
      }
    }

    for (const block of page.blocks) {
      const rect: Rect = placeBlock(box, block)
      doc.save()
      if (block.rotationDeg) {
        const cx = rect.x + rect.w / 2
        const cy = rect.y + rect.h / 2
        doc.rotate(block.rotationDeg, { origin: [cx, cy] })
      }
      drawBlock(doc, block, rect, { theme, scale, muted, line, imageFor, cropFor, paint })
      doc.fillOpacity(1)
      doc.restore()
    }

    // Подвал вне безопасной области: номер страницы, название, режим цен.
    const footY = footerBaselineY(H, W, bleed)
    doc.font('body').fontSize(Math.max(4.5, 5.5 * scale)).fillColor(paint(muted))
    doc.text(clip(view.title.toUpperCase(), 60), padX, footY, { width: cbW * 0.6, lineBreak: false })
    doc.text(
      `${metrics.label} · ${metrics.mm} · ${pi + 1}/${pages.length}${view.priceMode === 'frozen' ? ' · цены зафиксированы' : ''}`,
      padX,
      footY,
      { width: cbW, align: 'right', lineBreak: false },
    )

    if (opts.preset === 'print' && bleed > 0) {
      const m = bleed
      doc.strokeColor(paint('#000000')).lineWidth(0.3)
      const marks = [
        [m, 0, m, 6],
        [0, m, 6, m],
        [W - m, 0, W - m, 6],
        [W, m, W - 6, m],
        [m, H, m, H - 6],
        [0, H - m, 6, H - m],
        [W - m, H, W - m, H - 6],
        [W, H - m, W - 6, H - m],
      ]
      for (const [x1, y1, x2, y2] of marks) {
        doc.moveTo(x1!, y1!).lineTo(x2!, y2!).stroke()
      }
    }
  }

  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((res, rej) => {
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => res(Buffer.concat(chunks)))
    doc.on('error', rej)
  })
  doc.end()
  return done
}

/** Для тестов и диагностики: встроенный шрифт реально на месте. */
export function fontFileExists(kind: keyof typeof FONTS): boolean {
  return existsSync(FONTS[kind]) && readFileSync(FONTS[kind]).length > 1000
}
