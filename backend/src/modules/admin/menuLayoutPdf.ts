/**
 * PDF макета меню: векторный текст (ToUnicode), брендовые шрифты, несколько страниц.
 *
 * Почему PDFKit, а не «печать страницы в PDF»: типографии нужен текст, а не растр.
 * Здесь все надписи — реальные глифы встроенных Golos Text и Unbounded, картинки — только фото.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../../config'
import { flowPage, formatMetrics, type RenderBlock } from './menuLayoutDoc'
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

/** Ограничение ширины строки: длинное название не должно ломать колонку. */
function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…` : t
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

/**
 * Рендер всех страниц макета. Возвращает готовый PDF-буфер.
 * Ошибки отдельных фото не валят экспорт: лист печатается без картинки, о чём сказано в замечаниях.
 */
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
  const pad = Math.round(34 * scale) + bleed
  const contentW = W - pad * 2
  const muted = theme.preset === 'dark' ? '#A5A39D' : theme.preset === 'season' ? '#76695B' : '#6E6A62'
  const line = theme.preset === 'dark' ? '#3B3F49' : theme.preset === 'season' ? '#D9C9B3' : '#D8D2C7'

  const pages = view.doc.pages

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi]!
    doc.addPage({ size: [W, H], margin: 0 })
    doc.rect(0, 0, W, H).fill(theme.bg)

    const flow = flowPage(page.blocks as RenderBlock[], theme.columns)
    let y = pad

    // ── шапка / hero ────────────────────────────────────────────
    const header = flow.lead.find((b) => b.type === 'header')
    const hero = flow.lead.find((b) => b.type === 'hero')
    const edition = header?.text ?? ''
    const brandSize = 22 * scale

    if (theme.logoPosition !== 'footer') {
      const brandX = theme.logoPosition === 'top-right' ? W - pad - 80 * scale : pad
      drawBrand(doc, brandX, y, brandSize, theme.text, theme.accent)
      if (edition) {
        doc.font('body').fontSize(7 * scale).fillColor(muted)
        doc.text(edition.toUpperCase(), pad, y + 2, {
          width: contentW,
          align: theme.logoPosition === 'top-right' ? 'left' : 'right',
          lineBreak: true,
        })
      }
      y += brandSize + 26 * scale
    }

    if (hero) {
      const kicker = hero.text ?? ''
      if (kicker) {
        doc.font('bodyBold').fontSize(6.5 * scale).fillColor(theme.accent)
        doc.text(kicker.toUpperCase(), pad, y, { width: contentW * 0.6, lineBreak: false })
        y += 11 * scale
      }
      const title = clip(hero.titleOverride ?? 'Меню', 80)
      const titleSize = theme.headingSize * scale
      doc.font(theme.fontHeading === 'Unbounded' ? 'display' : 'body').fontSize(titleSize).fillColor(theme.text)
      const titleW = contentW * 0.62
      doc.text(title, pad, y, { width: titleW, lineBreak: true })
      const titleH = doc.heightOfString(title, { width: titleW })
      y += titleH + 6 * scale
    }

    if (theme.ornament !== 'none') {
      const oy = pad + 45 * scale
      const ox = W - pad - 30 * scale
      doc.strokeColor(theme.accent).lineWidth(1)
      if (theme.ornament === 'line') {
        doc.moveTo(ox, oy).lineTo(ox + 23 * scale, oy).stroke()
        doc.rect(ox + 26 * scale, oy - 2, 4 * scale, 4 * scale).fill(theme.accent)
      } else if (theme.ornament === 'beans') {
        doc.circle(ox + 4, oy, 3 * scale).fill(theme.accent)
        doc.circle(ox + 14 * scale, oy + 2, 2.4 * scale).fill(theme.accent)
      } else {
        doc.moveTo(ox, oy).lineTo(ox + 28 * scale, oy).stroke()
      }
    }

    // линия-разделитель под hero
    doc.strokeColor(theme.accent).lineWidth(1)
    doc.moveTo(pad, y + 4).lineTo(pad + 50 * scale, y + 4).stroke()
    doc.circle(pad + 55 * scale, y + 4, 2 * scale).fill(theme.accent)
    y += 20 * scale

    // ── колонки категорий ───────────────────────────────────────
    const colCount = Math.max(1, flow.columns.length)
    const gap = 30 * scale
    const colW = (contentW - gap * (colCount - 1)) / colCount
    const itemSize = theme.itemSize * scale
    const baseGap = (theme.density === 'air' ? 9 : theme.density === 'dense' ? 3 : 6) * scale
    const rowCount = flow.columns.reduce(
      (sum, col) => sum + col.reduce((n, g) => n + g.products.length + (g.category ? 1 : 0), 0),
      0,
    )
    // Подвал листа прижат к низу (как в вёрстке прототипа), поэтому его высоту вычитаем заранее.
    const tailHeight = flow.tail.reduce((sum, b) => {
      if (b.type === 'note' || b.type === 'text') return sum + 34 * scale
      if (b.type === 'divider') return sum + 12 * scale
      if (b.type === 'photo' || b.type === 'qr') return sum + 80 * scale
      return sum
    }, 0)
    const footerReserve = 22 * scale
    const free = Math.max(0, H - pad - footerReserve - tailHeight - y)
    // Лист не должен оставаться пустым на две трети: распределяем свободную высоту между строками.
    const extraGap = rowCount > 1 ? Math.max(0, Math.min(24 * scale, free / rowCount - baseGap)) : 0
    const rowGap = baseGap + extraGap
    let maxBottom = y
    let categoryOrdinal = 0

    flow.columns.forEach((groups, ci) => {
      const x = pad + ci * (colW + gap)
      let cy = y
      for (const group of groups) {
        if (group.category) {
          categoryOrdinal += 1
          const name = clip(group.category.titleOverride ?? group.category.displayCategory ?? 'Категория', 40)
          doc.font(theme.fontHeading === 'Unbounded' ? 'display' : 'body').fontSize(13 * scale).fillColor(theme.accent)
          doc.text(name, x, cy, { width: colW - 18 * scale, lineBreak: false })
          doc.font('body').fontSize(6 * scale).fillColor(muted)
          doc.text(String(categoryOrdinal).padStart(2, '0'), x, cy + 3 * scale, { width: colW, align: 'right', lineBreak: false })
          cy += 17 * scale
          doc.strokeColor(line).lineWidth(0.6).moveTo(x, cy).lineTo(x + colW, cy).stroke()
          cy += 8 * scale
        }
        for (const p of group.products) {
          const name = clip(p.displayName ?? p.titleOverride ?? 'Позиция', 60)
          const price = p.displayPrice ?? '—'
          doc.font('bodyBold').fontSize(itemSize).fillColor(theme.text)
          doc.text(name, x, cy, { width: colW - 46 * scale, lineBreak: false, ellipsis: true })
          doc.font('body').fontSize(itemSize).fillColor(theme.text)
          doc.text(price, x, cy, { width: colW, align: 'right', lineBreak: false })
          let rowH = itemSize * 1.5
          const sub = p.product?.variantLabel
          if (sub) {
            doc.font('body').fontSize(7.5 * scale).fillColor(muted)
            doc.text(sub, x, cy + itemSize * 1.25, { width: colW - 46 * scale, lineBreak: false })
            rowH += 7.5 * scale
          }
          if (p.badge) {
            doc.font('bodyBold').fontSize(5 * scale).fillColor(theme.accent)
            doc.text(p.badge.toUpperCase(), x, cy + rowH, { width: colW, lineBreak: false })
            rowH += 7 * scale
          }
          cy += rowH + rowGap
          doc.strokeColor(line).lineWidth(0.4).dash(1, { space: 2 })
            .moveTo(x, cy - rowGap / 2).lineTo(x + colW, cy - rowGap / 2).stroke().undash()
        }
      }
      maxBottom = Math.max(maxBottom, cy)
    })

    // ── блоки после категорий (прижаты к низу листа) ────────────
    let ty = Math.max(maxBottom + 12 * scale, H - pad - footerReserve - tailHeight)
    for (const b of flow.tail) {
      if (ty > H - pad - 60 * scale) break
      if (b.type === 'note' || b.type === 'text') {
        doc.strokeColor(line).lineWidth(0.8).rect(pad, ty, contentW, 1).stroke()
        doc.font('displayBold').fontSize(9 * scale).fillColor(theme.text)
        doc.text(clip(b.titleOverride ?? b.text ?? 'Заметка', 90), pad, ty + 6 * scale, { width: contentW })
        ty += 34 * scale
      } else if (b.type === 'divider') {
        doc.strokeColor(line).lineWidth(0.6).moveTo(pad, ty).lineTo(pad + contentW, ty).stroke()
        ty += 10 * scale
      } else if (b.type === 'photo' || (b.type === 'qr')) {
        const img = imagePathFor(b.snapshotImageUrl)
        const boxH = 70 * scale
        if (img) {
          try {
            doc.image(img, pad, ty, { fit: [contentW * 0.45, boxH] })
          } catch {
            doc.rect(pad, ty, contentW * 0.45, boxH).stroke(line)
          }
        } else {
          doc.strokeColor(line).lineWidth(0.8).rect(pad, ty, contentW * 0.45, boxH).stroke()
          doc.font('body').fontSize(7 * scale).fillColor(muted)
          doc.text(b.type === 'qr' ? 'меню по QR · 67coffee.ru' : 'фото', pad + 6, ty + boxH / 2 - 4, { width: contentW * 0.45 - 12 })
        }
        doc.font('displayBold').fontSize(10 * scale).fillColor(theme.text)
        doc.text(clip(b.titleOverride ?? '6.7 Coffee', 60), pad + contentW * 0.5, ty + 2, { width: contentW * 0.5 })
        if (b.text) {
          doc.font('body').fontSize(7 * scale).fillColor(muted)
          doc.text(b.text, pad + contentW * 0.5, ty + 16 * scale, { width: contentW * 0.5 })
        }
        ty += boxH + 10 * scale
      }
    }

    // ── подвал ──────────────────────────────────────────────────
    const footerY = H - pad
    doc.strokeColor(line).lineWidth(0.6).moveTo(pad, footerY - 14 * scale).lineTo(W - pad, footerY - 14 * scale).stroke()
    doc.font('body').fontSize(5.5 * scale).fillColor(muted)
    if (theme.logoPosition === 'footer') {
      doc.font('displayBold').fontSize(8 * scale).fillColor(theme.text).text('6▪7', pad, footerY - 10 * scale, { lineBreak: false })
      doc.font('body').fontSize(5.5 * scale).fillColor(muted)
    }
    doc.text(clip(view.title.toUpperCase(), 60), pad, footerY - 8 * scale, { width: contentW * 0.5, lineBreak: false })
    doc.text(
      `${metrics.label} · ${metrics.mm} · ${pi + 1}/${pages.length}${view.priceMode === 'frozen' ? ' · цены зафиксированы' : ''}`,
      pad,
      footerY - 8 * scale,
      { width: contentW, align: 'right', lineBreak: false },
    )

    // ── метки реза для печати ───────────────────────────────────
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

/** Для тестов и диагностики: путь к встроенному шрифту (проверяем, что файл реально есть). */
export function fontFileExists(kind: keyof typeof FONTS): boolean {
  return existsSync(FONTS[kind]) && readFileSync(FONTS[kind]).length > 1000
}
