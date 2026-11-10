/**
 * Макет меню для гостя/типографии: CRUD + рендер PDF.
 *
 * Важно: этот раздел не меняет каталог. Скрытая в макете позиция остаётся в «Меню»,
 * на кассе и в PWA — макет лишь лист для печати.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import {
  DEFAULT_RECT,
  DEFAULT_THEME,
  collectBlockers,
  docStats,
  formatMetrics,
  migrateDocToCanvas,
  normalizeDoc,
  normalizeTheme,
  resolveDoc,
  type LayoutFormat,
  type MenuBlock,
  type MenuDoc,
  type MenuTheme,
  type PriceMode,
} from './menuLayoutDoc'
import { loadCatalogProducts } from './menuLayoutDoc'
import { renderLayoutPdf } from './menuLayoutPdf'

type Row = {
  id: number
  title: string
  format: string
  status: string
  theme_json: string
  doc_json: string
  price_mode: string
  frozen_at: number | null
  created_at: number
  updated_at: number
}

/** Аудит пишется middleware на изменяющие вызовы: тип нужен, чтобы `c.set('audit', …)` прошёл проверку. */
type Env = { Variables: { audit?: { entity: string; entityId: string; summary: string } } }

const FORMATS = ['a4_portrait', 'a4_landscape', 'a3_portrait', 'ratio_1_1', 'screen_16_9'] as const

const jsonParse = <T>(raw: string, fallback: T): T => {
  try {
    const v = JSON.parse(raw)
    return (v && typeof v === 'object' ? v : fallback) as T
  } catch {
    return fallback
  }
}

const pageId = () => `page-${Math.random().toString(36).slice(2, 8)}`

/** Стартовый лист: логотип сверху слева и заголовок — уже в координатах холста. */
/** Пустой блок нужного типа в координатах по умолчанию. */
export function emptyBlock(type: MenuBlock['type']): MenuBlock {
  return {
    id: `${type}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    xPct: 0,
    yPct: 0,
    wPct: DEFAULT_RECT[type]?.w ?? 30,
    hPct: DEFAULT_RECT[type]?.h ?? 8,
    zIndex: 0,
    rotationDeg: 0,
    hidden: false,
    productId: null,
    categoryId: null,
    titleOverride: null,
    priceRubOverride: null,
    priceText: null,
    showPhoto: false,
    photoUrlOverride: null,
    badge: null,
    text: null,
    url: null,
    fit: 'cover',
    fontSizePt: 10,
    align: 'left',
    bold: false,
    snapshotPriceRub: null,
    snapshotName: null,
    snapshotImageUrl: null,
    sortOrder: 0,
  }
}

export function emptyDoc(): MenuDoc {
  const base = (over: Partial<MenuBlock> & Pick<MenuBlock, 'id' | 'type'>): MenuBlock => ({
    xPct: 0,
    yPct: 0,
    wPct: DEFAULT_RECT[over.type]?.w ?? 30,
    hPct: DEFAULT_RECT[over.type]?.h ?? 8,
    zIndex: 0,
    rotationDeg: 0,
    hidden: false,
    productId: null,
    categoryId: null,
    titleOverride: null,
    priceRubOverride: null,
    priceText: null,
    showPhoto: false,
    photoUrlOverride: null,
    badge: null,
    text: null,
    url: null,
    fit: 'cover',
    fontSizePt: 10,
    align: 'left',
    bold: false,
    snapshotPriceRub: null,
    snapshotName: null,
    snapshotImageUrl: null,
    sortOrder: 0,
    ...over,
  })
  return {
    pages: [
      {
        id: 'page-1',
        blocks: [
          base({ id: 'logo-1', type: 'logo', xPct: 0, yPct: 0, wPct: 32, hPct: 7, text: 'весна / лето 2026', zIndex: 0, sortOrder: 0 }),
          base({
            id: 'title-1',
            type: 'text',
            xPct: 0,
            yPct: 8,
            wPct: 80,
            hPct: 12,
            text: 'Кофе и не только',
            fontSizePt: 34,
            zIndex: 1,
            sortOrder: 1,
          }),
        ],
      },
    ],
  }
}

function rowById(id: number): Row | undefined {
  return db.prepare('SELECT * FROM menu_layouts WHERE id=?').get(id) as Row | undefined
}

type LayoutView = {
  id: number
  title: string
  format: LayoutFormat
  status: 'draft' | 'ready'
  theme: MenuTheme
  priceMode: PriceMode
  frozenAt: number | null
  createdAt: number
  updatedAt: number
  doc: ReturnType<typeof resolveDoc>
  stats: { pages: number; products: number; warnings: number }
  drift: { blockId: string; pageId: string; title: string; from: number | null; to: number | null }[]
  blockers: { blockId: string; pageId: string; code: string; text: string }[]
  formatHint: { label: string; mm: string }
}

function layoutView(row: Row): LayoutView {
  const theme = normalizeTheme(jsonParse<unknown>(row.theme_json, {}))
  // Старые (flow) макеты раскладываются в координаты при чтении — редактор и PDF работают только с холстом.
  const doc = migrateDocToCanvas(normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc())))
  const resolved = resolveDoc(doc, row.price_mode === 'frozen' ? 'frozen' : 'live')
  const drift: LayoutView['drift'] = []
  for (const page of resolved.pages) {
    for (const b of page.blocks) {
      if (b.type !== 'product') continue
      if (b.priceRubOverride != null) continue
      const snapshot = b.snapshotPriceRub
      const live = b.catalogPriceRub ?? null
      if (snapshot != null && live != null && snapshot !== live) {
        drift.push({ blockId: b.id, pageId: page.id, title: b.displayName ?? b.snapshotName ?? 'позиция', from: snapshot, to: live })
      }
    }
  }
  return {
    id: row.id,
    title: row.title,
    format: (FORMATS as readonly string[]).includes(row.format) ? (row.format as LayoutFormat) : 'a4_portrait',
    status: row.status === 'ready' ? 'ready' : 'draft',
    theme,
    priceMode: row.price_mode === 'frozen' ? 'frozen' : 'live',
    frozenAt: row.frozen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    doc: resolved,
    stats: docStats(resolved),
    drift,
    blockers: collectBlockers(resolved),
    formatHint: formatMetrics(row.format),
  }
}

/** Снапшот цен/названий/фото: нужен и для режима frozen, и для баннера «каталог изменился». */
export function snapshotDoc(doc: MenuDoc): { doc: MenuDoc; changed: { blockId: string; title: string; from: number | null; to: number | null }[] } {
  const ids = doc.pages
    .flatMap((p) => p.blocks.filter((b) => b.type === 'product').map((b) => b.productId))
    .filter((n): n is number => typeof n === 'number')
  const catalog = loadCatalogProducts(ids)
  const changed: { blockId: string; title: string; from: number | null; to: number | null }[] = []
  const pages = doc.pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((b) => {
      if (b.type !== 'product') return b
      const p = b.productId == null ? null : catalog.get(b.productId) ?? null
      if (!p) return b
      if (b.snapshotPriceRub != null && b.snapshotPriceRub !== p.priceRub && b.priceRubOverride == null) {
        changed.push({ blockId: b.id, title: b.titleOverride ?? p.name, from: b.snapshotPriceRub, to: p.priceRub })
      }
      return { ...b, snapshotPriceRub: p.priceRub, snapshotName: p.name, snapshotImageUrl: p.imageUrl }
    }),
  }))
  return { doc: { pages }, changed }
}

const blockZ = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['product', 'category', 'text', 'image', 'logo', 'divider', 'header', 'hero', 'note', 'photo', 'qr']),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  wPct: z.number().min(1).max(100),
  hPct: z.number().min(0.5).max(100),
  zIndex: z.number().int().min(0).max(9999).optional(),
  rotationDeg: z.number().min(-180).max(180).optional(),
  hidden: z.boolean().optional(),
  productId: z.number().int().positive().nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  titleOverride: z.string().max(120).nullable().optional(),
  priceRubOverride: z.number().int().min(0).max(1_000_000).nullable().optional(),
  priceText: z.string().max(40).nullable().optional(),
  showPhoto: z.boolean().optional(),
  photoUrlOverride: z.string().max(500).nullable().optional(),
  badge: z.string().max(16).nullable().optional(),
  text: z.string().max(400).nullable().optional(),
  url: z.string().max(500).nullable().optional(),
  fit: z.enum(['cover', 'contain']).optional(),
  fontSizePt: z.number().min(5).max(72).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  bold: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  snapshotPriceRub: z.number().int().nullable().optional(),
  snapshotName: z.string().max(120).nullable().optional(),
  snapshotImageUrl: z.string().max(400).nullable().optional(),
})

const docZ = z.object({
  pages: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        blocks: z.array(blockZ).max(400),
      }),
    )
    .min(1)
    .max(12),
})

const themeZ = z.object({
  preset: z.enum(['classic', 'dark', 'season']).optional(),
  bg: z.string().max(7).optional(),
  text: z.string().max(7).optional(),
  accent: z.string().max(7).optional(),
  backgroundImageUrl: z.string().max(500).nullable().optional(),
  backgroundDim: z.number().min(0).max(80).optional(),
  fontHeading: z.enum(['Unbounded', 'Golos Text']).optional(),
  fontBody: z.enum(['Golos Text', 'Unbounded']).optional(),
  itemSize: z.number().min(8).max(16).optional(),
  ornament: z.enum(['none', 'line', 'beans', 'leaf']).optional(),
  logoPosition: z.enum(['left', 'top-right', 'footer']).optional(),
})

const requireWrite = (role: string | undefined) => {
  if (role === 'viewer') throw bad('Read-only admin token', 403)
}

export const adminMenuLayouts = new Hono<Env>()
  .get('/menu-layouts', (c) => {
    const rows = db.prepare('SELECT * FROM menu_layouts ORDER BY updated_at DESC').all() as Row[]
    return c.json({
      layouts: rows.map((r) => {
        const v = layoutView(r)
        return {
          id: v.id,
          title: v.title,
          format: v.format,
          formatLabel: v.formatHint.label,
          status: v.status,
          priceMode: v.priceMode,
          frozenAt: v.frozenAt,
          updatedAt: v.updatedAt,
          stats: v.stats,
          drift: v.drift.length,
          blockers: v.blockers.length,
          // Превью-миниатюра в списке рисуется по теме и первым блокам, без второго запроса.
          preview: { theme: v.theme, firstPage: v.doc.pages[0]?.blocks.slice(0, 40) ?? [] },
        }
      }),
    })
  })

  .post('/menu-layouts', zValidator('json', z.object({ title: z.string().trim().min(1).max(120), format: z.enum(FORMATS).optional() })), (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const { title, format } = c.req.valid('json')
    const now = Date.now()
    const info = db
      .prepare(
        `INSERT INTO menu_layouts(title, format, status, theme_json, doc_json, price_mode, created_at, updated_at)
         VALUES(?,?, 'draft', ?, ?, 'live', ?, ?)`,
      )
      .run(title, format ?? 'a4_portrait', JSON.stringify(DEFAULT_THEME), JSON.stringify(emptyDoc()), now, now)
    const row = rowById(Number(info.lastInsertRowid))!
    c.set('audit', { entity: 'menu-layout', entityId: String(row.id), summary: `Макет меню «${title}» создан` })
    return c.json({ ok: true, layout: layoutView(row) }, 201)
  })

  .get('/menu-layouts/:id', (c) => {
    const row = rowById(Number(c.req.param('id')))
    if (!row) throw bad('Макет не найден', 404)
    return c.json({ layout: layoutView(row) })
  })

  .put(
    '/menu-layouts/:id',
    zValidator(
      'json',
      z.object({
        title: z.string().trim().min(1).max(120).optional(),
        theme: themeZ.optional(),
        doc: docZ.optional(),
        status: z.enum(['draft', 'ready']).optional(),
        priceMode: z.enum(['live', 'frozen']).optional(),
        format: z.enum(FORMATS).optional(),
      }),
    ),
    (c) => {
      requireWrite(c.get('adminRole' as never) as string | undefined)
      const id = Number(c.req.param('id'))
      const row = rowById(id)
      if (!row) throw bad('Макет не найден', 404)
      const body = c.req.valid('json')
      const now = Date.now()

      let doc = body.doc ? migrateDocToCanvas(normalizeDoc(body.doc)) : undefined
      let priceMode: PriceMode = body.priceMode ?? (row.price_mode === 'frozen' ? 'frozen' : 'live')
      let frozenAt = row.frozen_at
      // Переключение на frozen фиксирует текущие цены каталога, иначе лист «поплывёт» после правок каталога.
      if (body.priceMode === 'frozen' && row.price_mode !== 'frozen') {
        const snap = snapshotDoc(doc ?? migrateDocToCanvas(normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc()))))
        doc = snap.doc
        frozenAt = now
      }
      if (body.priceMode === 'live') frozenAt = null
      // В live-режиме снапшот обновляем на каждом сохранении: он нужен баннеру «каталог изменился».
      if (priceMode === 'live') {
        const snap = snapshotDoc(doc ?? migrateDocToCanvas(normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc()))))
        doc = snap.doc
      }

      const theme = body.theme ? normalizeTheme({ ...normalizeTheme(jsonParse<unknown>(row.theme_json, {})), ...body.theme }) : undefined

      db.prepare(
        `UPDATE menu_layouts SET
           title = COALESCE(?, title),
           format = COALESCE(?, format),
           status = COALESCE(?, status),
           theme_json = COALESCE(?, theme_json),
           doc_json = COALESCE(?, doc_json),
           price_mode = ?,
           frozen_at = ?,
           updated_at = ?
         WHERE id = ?`,
      ).run(
        body.title ?? null,
        body.format ?? null,
        body.status ?? null,
        theme ? JSON.stringify(theme) : null,
        doc ? JSON.stringify(doc) : null,
        priceMode,
        frozenAt,
        now,
        id,
      )
      const updated = rowById(id)!
      c.set('audit', { entity: 'menu-layout', entityId: String(id), summary: `Макет меню «${updated.title}» сохранён` })
      return c.json({ ok: true, layout: layoutView(updated), savedAt: now })
    },
  )

  .delete('/menu-layouts/:id', (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const id = Number(c.req.param('id'))
    const row = rowById(id)
    if (!row) throw bad('Макет не найден', 404)
    db.prepare('DELETE FROM menu_layouts WHERE id=?').run(id)
    c.set('audit', { entity: 'menu-layout', entityId: String(id), summary: `Макет меню «${row.title}» удалён` })
    return c.json({ ok: true })
  })

  .post('/menu-layouts/:id/duplicate', (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const row = rowById(Number(c.req.param('id')))
    if (!row) throw bad('Макет не найден', 404)
    const now = Date.now()
    const info = db
      .prepare(
        `INSERT INTO menu_layouts(title, format, status, theme_json, doc_json, price_mode, frozen_at, created_at, updated_at)
         VALUES(?,?, 'draft', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `${row.title} — копия`.slice(0, 120),
        row.format,
        row.theme_json,
        row.doc_json,
        row.price_mode,
        row.frozen_at,
        now,
        now,
      )
    const created = rowById(Number(info.lastInsertRowid))!
    c.set('audit', { entity: 'menu-layout', entityId: String(created.id), summary: `Макет меню «${row.title}» скопирован` })
    return c.json({ ok: true, layout: layoutView(created) }, 201)
  })

  /** Обновляет снапшот цен из каталога и возвращает список расхождений для баннера. */
  .post('/menu-layouts/:id/sync-prices', (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const id = Number(c.req.param('id'))
    const row = rowById(id)
    if (!row) throw bad('Макет не найден', 404)
    const doc = normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc()))
    const { doc: next, changed } = snapshotDoc(doc)
    // frozen: снапшот — это и есть зафиксированные цены, их не переписываем молча.
    const applied = row.price_mode !== 'frozen'
    if (applied) {
      db.prepare('UPDATE menu_layouts SET doc_json=?, updated_at=? WHERE id=?').run(JSON.stringify(next), Date.now(), id)
    }
    c.set('audit', {
      entity: 'menu-layout',
      entityId: String(id),
      summary: applied ? `Макет меню: цены обновлены с каталога (${changed.length})` : 'Макет меню: проверка цен каталога',
    })
    return c.json({ ok: true, applied, changed, layout: layoutView(rowById(id)!) })
  })

  /** «Собрать из каталога»: одна кнопка — категории и доступные позиции на лист. */
  .post(
    '/menu-layouts/:id/seed-from-catalog',
    zValidator(
      'json',
      z
        .object({
          pageId: z.string().max(64).optional(),
          replace: z.boolean().optional(),
          categoryIds: z.array(z.number().int().positive()).max(60).optional(),
        })
        .optional(),
    ),
    (c) => {
      requireWrite(c.get('adminRole' as never) as string | undefined)
      const id = Number(c.req.param('id'))
      const row = rowById(id)
      if (!row) throw bad('Макет не найден', 404)
      const body = (c.req.valid('json') ?? {}) as { pageId?: string; replace?: boolean; categoryIds?: number[] }
      const wanted = body.categoryIds?.length ? new Set(body.categoryIds) : null

      const categories = db
        .prepare('SELECT id, name FROM categories WHERE available=1 ORDER BY sort_order, id')
        .all() as { id: number; name: string }[]
      const products = db
        .prepare(
          `SELECT id, name, price, category_id AS categoryId, image_url AS imageUrl, variant_label AS variantLabel
             FROM products WHERE available=1 ORDER BY sort_order, id`,
        )
        .all() as { id: number; name: string; price: number; categoryId: number | null; imageUrl: string | null; variantLabel: string | null }[]

      const doc = migrateDocToCanvas(normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc())))
      const targetPage = body.pageId ? doc.pages.find((p) => p.id === body.pageId) : doc.pages[0]
      if (!targetPage) throw bad('Страница не найдена', 404)

      // Сборка из каталога — не «поток», а сетка холста: две колонки, позиции встают по порядку.
      const COLS = 2
      const COL_W = 44
      const COL_GAP = 6
      const ROW_H = 6.2
      const ROW_CAT = 6.5
      const TOP = 22
      // replace сбрасывает каталог (категории и позиции), но оставляет оформление листа.
      const keep = body.replace
        ? targetPage.blocks.filter((b) => b.type === 'logo' || b.type === 'text' || b.type === 'image' || b.type === 'divider')
        : [...targetPage.blocks]
      const blocks: MenuBlock[] = [...keep]
      let z = blocks.reduce((m, b) => Math.max(m, b.zIndex), 0) + 1
      let gridCol = 0
      let gridRow = 0
      let added = 0
      let skippedDuplicate = 0

      // Один productId — один блок на весь макет: повторная сборка не должна плодить «Капучино ×N».
      const usedProductIds = new Set<number>()
      for (const p of doc.pages) {
        const pageBlocks = p.id === targetPage.id ? keep : p.blocks
        for (const b of pageBlocks) {
          if (b.type === 'product' && !b.hidden && b.productId != null) usedProductIds.add(b.productId)
        }
      }

      const place = (b: MenuBlock) => {
        b.zIndex = z++
        b.sortOrder = blocks.length
        blocks.push(b)
      }

      for (const cat of categories) {
        if (wanted && !wanted.has(cat.id)) continue
        const fresh = products.filter((p) => p.categoryId === cat.id && !usedProductIds.has(p.id))
        skippedDuplicate += products.filter((p) => p.categoryId === cat.id && usedProductIds.has(p.id)).length
        // Категория без новых позиций не нужна: иначе повторная сборка плодит пустые заголовки.
        if (fresh.length === 0) continue
        if (gridRow > 0) gridRow += 1
        place({
          ...emptyBlock('category'),
          id: `cat-${cat.id}-${Math.random().toString(36).slice(2, 7)}`,
          categoryId: cat.id,
          xPct: gridCol * (COL_W + COL_GAP),
          yPct: TOP + gridRow * ROW_H,
          wPct: COL_W,
          hPct: ROW_CAT - 1.5,
          sortOrder: blocks.length,
        })
        gridRow += 1
        for (const p of fresh) {
          // Колонка кончилась — переходим в следующую, как только упёрлись в низ листа.
          if (TOP + (gridRow + 1) * ROW_H > 92 && gridCol < COLS - 1) {
            gridCol += 1
            gridRow = 0
          }
          place({
            ...emptyBlock('product'),
            id: `p-${p.id}-${Math.random().toString(36).slice(2, 7)}`,
            productId: p.id,
            categoryId: cat.id,
            xPct: gridCol * (COL_W + COL_GAP),
            yPct: TOP + gridRow * ROW_H,
            wPct: COL_W,
            hPct: ROW_H - 1.8,
            snapshotPriceRub: p.price,
            snapshotName: p.name,
            snapshotImageUrl: p.imageUrl,
            sortOrder: blocks.length,
          })
          gridRow += 1
          usedProductIds.add(p.id)
          added++
        }
      }

      if (added === 0 && skippedDuplicate === 0) throw bad('В каталоге нет доступных позиций для сборки', 400)
      // Нечего добавлять — не трогаем updated_at, чтобы «Изменён» не врал.
      if (added === 0) return c.json({ ok: true, added: 0, skippedDuplicate, layout: layoutView(rowById(id)!) })

      const nextDoc: MenuDoc = {
        pages: doc.pages.map((p) => (p.id === targetPage.id ? { ...p, blocks } : p)),
      }
      db.prepare('UPDATE menu_layouts SET doc_json=?, updated_at=? WHERE id=?').run(JSON.stringify(nextDoc), Date.now(), id)
      c.set('audit', {
        entity: 'menu-layout',
        entityId: String(id),
        summary: `Макет собран из каталога: +${added}, пропущено дублей ${skippedDuplicate}`,
      })
      return c.json({ ok: true, added, skippedDuplicate, layout: layoutView(rowById(id)!) })
    },
  )

  /**
   * PDF. GET — чтобы работала обычная ссылка и `download()` в админке;
   * force=1 — скачать с предупреждениями (позиция без цены и т.п.).
   */
  .get('/menu-layouts/:id/export.pdf', async (c) => {
    const row = rowById(Number(c.req.param('id')))
    if (!row) throw bad('Макет не найден', 404)
    const layout = layoutView(row)
    const preset = c.req.query('preset') === 'screen' ? 'screen' : 'print'
    const bleedRaw = Number(c.req.query('bleed') ?? (preset === 'print' ? 3 : 0))
    const bleed = Number.isFinite(bleedRaw) ? Math.max(0, Math.min(10, bleedRaw)) : 0
    const force = c.req.query('force') === '1'
    const blocking = layout.blockers.filter((b) => b.code !== 'notice')
    if (blocking.length > 0 && !force) {
      return c.json({ ok: false, error: 'has_blockers', blockers: layout.blockers, stats: layout.stats }, 409)
    }
    const pdf = await renderLayoutPdf(layout, { preset, bleedMm: bleed })
    const name = `menu-${layout.id}-${new Date().toISOString().slice(0, 10)}.pdf`
    c.set('audit', { entity: 'menu-layout', entityId: String(layout.id), summary: `Экспорт PDF макета «${layout.title}»` })
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Length': String(pdf.length),
        'Cache-Control': 'no-store',
      },
    })
  })

export type { LayoutView }
