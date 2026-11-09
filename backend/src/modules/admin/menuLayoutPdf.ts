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
import { formatMetrics, type RenderBlock } from './menuLayoutDoc'
import type { LayoutView } from './menuLayouts'

const require = createRequire(import.meta.url)
type PdfDoc = any

const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts')

const FONTS = {
  body: join(FONT_DIR, 'GolosText-400.ttf'),
  bodyBold: join(FONT_DIR, 'GolosText-600.ttf'),
  display: join(FONT_DIR, 'Unbounded-400.ttf'),
  displayBold: join(FONT_DIR, 'Unbounded-600.ttf'),
}

export type PdfOptions = { preset: 'print' | 'screen'; bleedMm: number }

const MM_TO_PT = 72 / 25.4

/** Длинное название не должно вылезать за рамку блока. */
function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…` : t
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

function drawBrand(doc: PdfDoc, x: number, y: number, size: number, color: string, accent: string) {
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
  ctx: { theme: LayoutView['theme']; scale: number; muted: string; line: string; imageFor: (url: string | null | undefined) => Buffer | null },
) {
  const { theme, scale, muted, line, imageFor } = ctx
  const { x, y, w, h } = rect

  switch (block.type) {
    case 'logo': {
      const size = Math.min(h * 0.9, 26 * scale)
      drawBrand(doc, x, y + Math.max(0, (h - size) / 2), size, theme.text, theme.accent)
      if (block.text) {
        doc.font('body').fontSize(Math.max(5, Math.min(8 * scale, h * 0.35))).fillColor(muted)
        doc.text(block.text.toUpperCase(), x, y + h * 0.15, { width: w, align: 'right', lineBreak: false, ellipsis: true })
      }
      return
    }
    case 'text': {
      const size = Math.max(5, block.fontSizePt * scale)
      const content = clip(block.text ?? block.titleOverride ?? '', 240)
      if (!content) return
      doc.font(block.bold ? 'displayBold' : 'body').fontSize(size).fillColor(theme.text)
      doc.text(content, x, y, { width: w, height: h, align: block.align, ellipsis: true })
      return
    }
    case 'category': {
      const name = clip(block.titleOverride ?? block.displayCategory ?? 'Категория', 48)
      const size = Math.max(6, Math.min(h * 0.62, 15 * scale))
      doc.font(theme.fontHeading === 'Unbounded' ? 'displayBold' : 'bodyBold').fontSize(size).fillColor(theme.accent)
      doc.text(name, x, y, { width: w, height: h, lineBreak: false, ellipsis: true })
      doc.strokeColor(line).lineWidth(0.6).moveTo(x, y + h).lineTo(x + w, y + h).stroke()
      return
    }
    case 'divider': {
      doc.strokeColor(block.warnings.length ? '#B4472C' : line).lineWidth(1)
      doc.moveTo(x, y + h / 2).lineTo(x + w, y + h / 2).stroke()
      return
    }
    case 'image': {
      const src = imageFor(block.displayImageUrl ?? block.url)
      if (!src) {
        doc.strokeColor(line).lineWidth(0.8).rect(x, y, w, h).stroke()
        doc.font('body').fontSize(Math.max(5, 7 * scale)).fillColor(muted)
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
      const thumbSrc = block.showPhoto ? imageFor(block.displayImageUrl) : null
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
      const nameSize = Math.max(5, Math.min(h * 0.42, 11 * scale))
      const price = block.displayPrice ?? '—'
      doc.font('bodyBold').fontSize(nameSize).fillColor(theme.text)
      doc.text(clip(block.displayName ?? block.titleOverride ?? 'Позиция', 64), x + padX, y, {
        width: contentW - 40 * scale,
        height: h,
        lineBreak: false,
        ellipsis: true,
      })
      doc.font('body').fontSize(nameSize).fillColor(theme.text)
      doc.text(price, x + padX, y, { width: contentW, align: 'right', lineBreak: false })
      const sub = block.product?.variantLabel
      if (sub && h > nameSize * 2) {
        doc.font('body').fontSize(Math.max(4, nameSize * 0.72)).fillColor(muted)
        doc.text(sub, x + padX, y + nameSize * 1.35, { width: contentW - 40 * scale, lineBreak: false, ellipsis: true })
      }
      if (block.badge && h > nameSize * 2.6) {
        doc.font('bodyBold').fontSize(Math.max(4, nameSize * 0.5)).fillColor(theme.accent)
        doc.text(block.badge.toUpperCase(), x + padX, y + h - nameSize * 0.9, { width: contentW, lineBreak: false })
      }
      doc.strokeColor(line).lineWidth(0.4).dash(1, { space: 2 })
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

  doc.registerFont('body', FONTS.body)
  doc.registerFont('bodyBold', FONTS.bodyBold)
  doc.registerFont('display', FONTS.display)
  doc.registerFont('displayBold', FONTS.displayBold)

  const W = metrics.width
  const H = metrics.height
  const pad = Math.round(26 * scale) + bleed
  const cbW = W - pad * 2
  const cbH = H - pad * 2
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

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi]!
    doc.addPage({ size: [W, H], margin: 0 })
    doc.rect(0, 0, W, H).fill(theme.bg)

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
      const rect: Rect = {
        x: pad + (block.xPct / 100) * cbW,
        y: pad + (block.yPct / 100) * cbH,
        w: (block.wPct / 100) * cbW,
        h: (block.hPct / 100) * cbH,
      }
      doc.save()
      if (block.rotationDeg) {
        const cx = rect.x + rect.w / 2
        const cy = rect.y + rect.h / 2
        doc.rotate(block.rotationDeg, { origin: [cx, cy] })
      }
      drawBlock(doc, block, rect, { theme, scale, muted, line, imageFor })
      doc.restore()
    }

    // Подвал вне безопасной области: номер страницы, название, режим цен.
    const footY = H - pad * 0.62
    doc.font('body').fontSize(Math.max(4.5, 5.5 * scale)).fillColor(muted)
    doc.text(clip(view.title.toUpperCase(), 60), pad, footY, { width: cbW * 0.6, lineBreak: false })
    doc.text(
      `${metrics.label} · ${metrics.mm} · ${pi + 1}/${pages.length}${view.priceMode === 'frozen' ? ' · цены зафиксированы' : ''}`,
      pad,
      footY,
      { width: cbW, align: 'right', lineBreak: false },
    )

    if (opts.preset === 'print' && bleed > 0) {
      const m = bleed
      doc.strokeColor('#000000').lineWidth(0.3)
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
