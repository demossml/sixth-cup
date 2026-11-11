/**
 * Макет меню для гостя/типографии: CRUD + рендер PDF.
 *
 * Важно: этот раздел не меняет каталог. Скрытая в макете позиция остаётся в «Меню»,
 * на кассе и в PWA — макет лишь лист для печати.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import {
  DEFAULT_RECT,
  DEFAULT_THEME,
  FONT_FAMILIES,
  collectBlockers,
  docStats,
  formatMetrics,
  migrateDocToCanvas,
  normalizeDoc,
  normalizeTheme,
  loadGroupSizes,
  loadVolumeSizes,
  resolveDoc,
  type LayoutFormat,
  type MenuBlock,
  type MenuDoc,
  type MenuSection,
  type MenuTheme,
  type PriceMode,
} from './menuLayoutDoc'
import { loadCatalogProducts } from './menuLayoutDoc'
import { flowSections, relayoutDoc } from './menuLayoutFlow'
import { MENU_TEMPLATES, findTemplate } from './menuTemplates'
import { applyOps, proposeByRules } from './menuLayoutAi'
import { renderLayoutPdf } from './menuLayoutPdf'
import { printChecks } from './printChecks'
import { imposePlan as imposePlanFor, parseImpose } from './imposition'

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
  rev: number
}

/** Аудит пишется middleware на изменяющие вызовы: тип нужен, чтобы `c.set('audit', …)` прошёл проверку. */
type Env = { Variables: { audit?: { entity: string; entityId: string; summary: string } } }

const FORMATS = ['a4_portrait', 'a4_landscape', 'a5_portrait', 'a3_portrait', 'ratio_1_1', 'screen_16_9'] as const

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
    photoCrop: null,
    fontSizePt: 10,
    align: 'left',
    bold: false,
    lineHeight: 1.15,
    tracking: 0,
    uppercase: false,
    locked: false,
    groupId: null,
    snapshotPriceRub: null,
    snapshotName: null,
    snapshotImageUrl: null,
    snapshotSizes: null,
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
    photoCrop: null,
    fontSizePt: 10,
    align: 'left',
    bold: false,
    lineHeight: 1.15,
    tracking: 0,
    uppercase: false,
    locked: false,
    groupId: null,
    snapshotPriceRub: null,
    snapshotName: null,
    snapshotImageUrl: null,
    snapshotSizes: null,
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
  /** Версия документа: клиент присылает baseRev, чтобы не затирать чужие правки. */
  rev: number
  doc: ReturnType<typeof resolveDoc> & { styles?: MenuDoc['styles']; comments?: MenuDoc['comments'] }
  stats: { pages: number; products: number; warnings: number }
  drift: { blockId: string; pageId: string; title: string; from: number | null; to: number | null }[]
  blockers: { blockId: string; pageId: string; code: string; text: string }[]
  formatHint: { label: string; mm: string }
  /** Сколько секций в документе (v2): нужно кнопке «Пересобрать лист». */
  sections: number
  schemaVersion: number
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
    rev: Number(row.rev) || 1,
    // Клиент редактирует блоки и секции вместе: секции отдаём как есть, они не резолвятся.
    doc: {
      ...resolved,
      schemaVersion: doc.schemaVersion ?? 1,
      // Стили — часть документа: без них при открытии макета пропадала бы привязка блоков.
      ...(doc.styles?.length ? { styles: doc.styles } : {}),
      // Замечания тоже: иначе они пропадали бы после перезагрузки редактора.
      ...(doc.comments?.length ? { comments: doc.comments } : {}),
      pages: resolved.pages.map((p, i) => ({
        ...p,
        ...(doc.pages[i]?.sections ? { sections: doc.pages[i]!.sections } : {}),
        ...(doc.pages[i]?.template ? { template: doc.pages[i]!.template } : {}),
      })),
    },
    stats: docStats(resolved),
    drift,
    // P3-3: к предупреждениям блоков добавляем то, что видно только на печати (dpi, контраст).
    blockers: [...collectBlockers(resolved), ...printChecks(resolved, theme, row.format as LayoutFormat)],
    formatHint: formatMetrics(row.format),
    sections: doc.pages.reduce((n, p) => n + (p.sections?.length ?? 0), 0),
    schemaVersion: doc.schemaVersion ?? 1,
  }
}

/** Объёмы и цены всех товаров пачкой: схемы объёмов + варианты групп, без N+1. */
function loadCatalogSizes(productIds: number[]) {
  return loadVolumeSizes(productIds)
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
      // Снимок объёмов нужен frozen-режиму: иначе после правки каталога цены «поплывут».
      const snapshotSizes =
        p.sizes.length > 1 && b.priceRubOverride == null && b.priceText == null
          ? p.sizes.map((sz) => ({ label: sz.label, price: sz.priceRub == null ? '' : String(sz.priceRub) }))
          : b.snapshotSizes
      return { ...b, snapshotPriceRub: p.priceRub, snapshotName: p.name, snapshotImageUrl: p.imageUrl, snapshotSizes }
    }),
  }))
  return { doc: { ...doc, pages }, changed }
}

/**
 * Сохранение не должно «съедать» расхождения с каталогом.
 *
 * `snapshotDoc` заполняет снапшоты текущими ценами. Если звать его на каждом сохранении,
 * правка любой плашки молча обнуляет баннер «каталог изменился» и предпросмотр P3-2.
 * Поэтому старые снапшоты сохраняем, а заполняем только пустые (новые блоки).
 */
export function keepSnapshots(prev: MenuDoc, next: MenuDoc): MenuDoc {
  const before = new Map(prev.pages.flatMap((p) => p.blocks).map((b) => [b.id, b]))
  return {
    ...next,
    pages: next.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((b) => {
        const was = before.get(b.id)
        if (!was || was.snapshotPriceRub == null) return b
        return {
          ...b,
          snapshotPriceRub: was.snapshotPriceRub,
          snapshotName: was.snapshotName ?? b.snapshotName,
          snapshotImageUrl: was.snapshotImageUrl ?? b.snapshotImageUrl,
          snapshotSizes: was.snapshotSizes ?? b.snapshotSizes,
        }
      }),
    })),
  }
}

/** Картинка блока — только файл из uploads админки: внешние URL не печатаются и тянут IP. */
const uploadUrlZ = z
  .string()
  .max(500)
  .regex(/^\/uploads\/[A-Za-z0-9._-]+$/, 'Картинка должна быть загружена в админку (/uploads/…)')
  .nullable()
  .optional()

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
  photoUrlOverride: uploadUrlZ,
  badge: z.string().max(16).nullable().optional(),
  text: z.string().max(400).nullable().optional(),
  url: uploadUrlZ,
  fit: z.enum(['cover', 'contain']).optional(),
  photoCrop: z
    .object({ zoom: z.number().min(1).max(3), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .nullable()
    .optional(),
  fontSizePt: z.number().min(5).max(72).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  bold: z.boolean().optional(),
  lineHeight: z.number().min(0.9).max(1.8).optional(),
  tracking: z.number().min(-50).max(200).optional(),
  uppercase: z.boolean().optional(),
  locked: z.boolean().optional(),
  // Привязка к мастер-стилю: без этого поля zod вырезал бы её при сохранении.
  styleId: z.string().max(64).nullable().optional(),
  groupId: z.string().max(64).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  snapshotPriceRub: z.number().int().nullable().optional(),
  snapshotName: z.string().max(120).nullable().optional(),
  snapshotImageUrl: z.string().max(400).nullable().optional(),
  snapshotSizes: z.array(z.object({ label: z.string().max(24), price: z.string().max(16) })).max(8).nullable().optional(),
  itemId: z.string().max(64).nullable().optional(),
  pinned: z.boolean().optional(),
})

const sizeZ = z.object({
  label: z.string().min(1).max(24),
  source: z.enum(['catalog', 'manual']),
  productId: z.number().int().positive().nullable().optional(),
  volumeItemId: z.number().int().positive().nullable().optional(),
  priceRubOverride: z.number().int().min(0).max(1_000_000).nullable().optional(),
})

const itemZ = z.object({
  id: z.string().min(1).max(64),
  productId: z.number().int().positive().nullable().optional(),
  groupId: z.number().int().positive().nullable().optional(),
  titleOverride: z.string().max(120).nullable().optional(),
  description: z.string().max(200).nullable().optional(),
  badge: z.string().max(16).nullable().optional(),
  showPhoto: z.boolean().optional(),
  photoUrlOverride: uploadUrlZ,
  sizes: z.array(sizeZ).max(8).optional(),
  hidden: z.boolean().optional(),
})

const sectionZ = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(60),
  categoryId: z.number().int().positive().nullable().optional(),
  style: z.object({ showPhotos: z.boolean() }).partial().optional(),
  items: z.array(itemZ).max(200).optional(),
})

const styleZ = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(40),
  fontSizePt: z.number().min(5).max(72),
  bold: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().min(0.9).max(1.8),
  tracking: z.number().min(-50).max(200),
  uppercase: z.boolean(),
})

const commentZ = z.object({
  id: z.string().min(1).max(64),
  blockId: z.string().min(1).max(64),
  text: z.string().min(1).max(500),
  author: z.string().max(40).nullable().optional(),
  createdAt: z.number().int().min(0).optional(),
  resolved: z.boolean().optional(),
})

const docZ = z.object({
  schemaVersion: z.number().int().min(1).max(2).optional(),
  // Мастер-стили блоков: часть документа, иначе zod вырезал бы их при сохранении.
  styles: z.array(styleZ).max(40).optional(),
  // Замечания к блокам: без этого zod терял бы их при сохранении.
  comments: z.array(commentZ).max(500).optional(),
  pages: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        blocks: z.array(blockZ).max(400),
        sections: z.array(sectionZ).max(20).optional(),
        template: z.string().max(40).nullable().optional(),
      }),
    )
    .min(1)
    .max(12),
})

const themeZ = z.object({
  preset: z.enum(['classic', 'dark', 'season']).optional(),
  // #RRGGBB или #RRGGBBAA: альфа нужна, чтобы цвет можно было сделать полупрозрачным.
  bg: z.string().max(9).optional(),
  text: z.string().max(9).optional(),
  accent: z.string().max(9).optional(),
  backgroundImageUrl: z.string().max(500).nullable().optional(),
  backgroundDim: z.number().min(0).max(80).optional(),
  fontHeading: z.enum(FONT_FAMILIES).optional(),
  fontBody: z.enum(FONT_FAMILIES).optional(),
  itemSize: z.number().min(8).max(16).optional(),
  ornament: z.enum(['none', 'line', 'beans', 'leaf']).optional(),
  logoPosition: z.enum(['left', 'top-right', 'footer']).optional(),
  recentColors: z.array(z.string().max(9)).max(8).optional(),
  gradient: z
    .object({ from: z.string().max(9), to: z.string().max(9), angle: z.number().min(0).max(360) })
    .nullable()
    .optional(),
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
          rev: v.rev,
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

  /**
   * Лёгкий каталог для пикера: только то, что нужно макету, с готовыми объёмами и ценами.
   * Заменяет `/products` + `/categories` (там N+1 по объёмам и лишние поля).
   */
  .get('/menu-layouts/templates', (c) => c.json({ ok: true, templates: MENU_TEMPLATES }))

  .get('/menu-layouts/catalog', (c) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.price, p.image_url AS imageUrl, p.available,
                p.category_id AS categoryId, c.name AS categoryName,
                p.variant_label AS variantLabel, p.size_value AS sizeValue, p.size_unit AS sizeUnit,
                p.group_id AS groupId
           FROM products p LEFT JOIN categories c ON c.id = p.category_id
          ORDER BY c.sort_order, p.sort_order, p.id`,
      )
      .all() as Array<{
      id: number
      name: string
      price: number
      imageUrl: string | null
      available: number
      categoryId: number | null
      categoryName: string | null
      variantLabel: string | null
      sizeValue: number | null
      sizeUnit: string | null
      groupId: number | null
    }>
    const volumes = loadVolumeSizes(rows.map((r) => Number(r.id)))
    const groups = loadGroupSizes(rows.map((r) => r.groupId).filter((n): n is number => n != null))
    const products = rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      price: Number(r.price) || 0,
      imageUrl: r.imageUrl ?? null,
      available: !!r.available,
      categoryId: r.categoryId == null ? null : Number(r.categoryId),
      categoryName: r.categoryName ?? null,
      variantLabel: r.variantLabel ?? null,
      // Один товар-вариант («Капучино 350 мл») — это часть группы объёмов.
      groupId: r.groupId == null ? null : Number(r.groupId),
      prices: volumes.get(Number(r.id)) ?? (r.groupId != null ? groups.get(Number(r.groupId)) : null) ?? null,
    }))
    const categories = db.prepare('SELECT id, name FROM categories ORDER BY sort_order, id').all()
    return c.json({ ok: true, products, categories })
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
        /** Версия, которую видел клиент. Не совпала — 409 rev_conflict. Без поля — «старый клиент», разрешаем. */
        baseRev: z.number().int().min(0).optional(),
      }),
    ),
    (c) => {
      requireWrite(c.get('adminRole' as never) as string | undefined)
      const id = Number(c.req.param('id'))
      const row = rowById(id)
      if (!row) throw bad('Макет не найден', 404)
      const body = c.req.valid('json')
      const now = Date.now()
      const currentRev = Number(row.rev) || 1
      // Два окна правят один макет: не даём молча затереть чужое сохранение.
      if (body.baseRev != null && body.baseRev !== currentRev) {
        return c.json(
          {
            ok: false,
            error: 'rev_conflict',
            rev: currentRev,
            layout: layoutView(row),
            message: 'Макет уже изменили в другом окне — обновите или перезапишите',
          },
          409,
        )
      }

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
      // В live-режиме снапшот нужен баннеру «каталог изменился» — но обновляем его только
      // у новых блоков: иначе сохранение стирало бы расхождения, которые владелец ещё не видел.
      if (priceMode === 'live') {
        const prevDoc = migrateDocToCanvas(normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc())))
        const base = doc ?? prevDoc
        const snap = snapshotDoc(base)
        // Переход frozen → live: цены «размораживаются» намеренно — берём живые.
        doc = row.price_mode === 'frozen' ? snap.doc : keepSnapshots(base, snap.doc)
        frozenAt = null
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
           updated_at = ?,
           rev = rev + 1
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

  /** AI: сначала предложение (операции над секциями), потом применение владельцем. */
  .post(
    '/menu-layouts/:id/ai/propose',
    zValidator('json', z.object({ prompt: z.string().trim().min(3).max(500) })),
    (c) => {
      requireWrite(c.get('adminRole' as never) as string | undefined)
      const row = rowById(Number(c.req.param('id')))
      if (!row) throw bad('Макет не найден', 404)
      const doc = normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc()))
      const plan = proposeByRules(c.req.valid('json').prompt, doc)
      c.set('audit', { entity: 'menu-layout', entityId: String(row.id), summary: `AI-черновик: ${plan.summary}` })
      return c.json({ ok: true, plan })
    },
  )

  .post(
    '/menu-layouts/:id/ai/apply',
    zValidator(
      'json',
      z.object({
        ops: z
          .array(
            z.discriminatedUnion('kind', [
              z.object({
                kind: z.literal('add-section'),
                title: z.string().min(1).max(60),
                categoryId: z.number().int().positive().nullable(),
                productIds: z.array(z.number().int().positive()).max(40),
              }),
              z.object({
                kind: z.literal('add-items'),
                sectionId: z.string().max(64),
                productIds: z.array(z.number().int().positive()).max(40),
              }),
              z.object({ kind: z.literal('hide-item'), sectionId: z.string().max(64), itemId: z.string().max(64) }),
              z.object({ kind: z.literal('remove-item'), sectionId: z.string().max(64), itemId: z.string().max(64) }),
              z.object({ kind: z.literal('rename-section'), sectionId: z.string().max(64), title: z.string().min(1).max(60) }),
              z.object({
                kind: z.literal('reorder-items'),
                sectionId: z.string().max(64),
                itemIds: z.array(z.string().max(64)).max(200),
              }),
            ]),
          )
          .min(1)
          .max(20),
        baseRev: z.number().int().min(0).optional(),
      }),
    ),
    (c) => {
      requireWrite(c.get('adminRole' as never) as string | undefined)
      const id = Number(c.req.param('id'))
      const row = rowById(id)
      if (!row) throw bad('Макет не найден', 404)
      const body = c.req.valid('json')
      const currentRev = Number(row.rev) || 1
      if (body.baseRev != null && body.baseRev !== currentRev) {
        return c.json({ ok: false, error: 'rev_conflict', rev: currentRev, layout: layoutView(row) }, 409)
      }
      const doc = migrateDocToCanvas(normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc())))
      const { doc: next, changed } = applyOps(doc, body.ops)
      const relaid = relayoutDoc(next)
      db.prepare('UPDATE menu_layouts SET doc_json=?, updated_at=?, rev=rev+1 WHERE id=?').run(
        JSON.stringify(relaid.doc),
        Date.now(),
        id,
      )
      c.set('audit', { entity: 'menu-layout', entityId: String(id), summary: `AI применён: изменений ${changed}` })
      return c.json({ ok: true, changed, dropped: relaid.dropped, layout: layoutView(rowById(id)!) })
    },
  )

  /**
   * Пересобрать лист из секций (движок раскладки). Закреплённые блоки остаются,
   * каталог раскладывается заново — с переносом на следующую страницу.
   */
  .post(
    '/menu-layouts/:id/layout',
    zValidator(
      'json',
      z
        .object({
          columns: z.union([z.literal(1), z.literal(2)]).optional(),
          template: z.string().max(40).optional(),
          baseRev: z.number().int().min(0).optional(),
        })
        .optional(),
    ),
    (c) => {
      requireWrite(c.get('adminRole' as never) as string | undefined)
      const id = Number(c.req.param('id'))
      const row = rowById(id)
      if (!row) throw bad('Макет не найден', 404)
      const body = (c.req.valid('json') ?? {}) as { columns?: 1 | 2; template?: string; baseRev?: number }
      const currentRev = Number(row.rev) || 1
      if (body.baseRev != null && body.baseRev !== currentRev) {
        return c.json({ ok: false, error: 'rev_conflict', rev: currentRev, layout: layoutView(row) }, 409)
      }
      const doc = migrateDocToCanvas(normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc())))
      const hasSections = doc.pages.some((p) => (p.sections?.length ?? 0) > 0)
      if (!hasSections) throw bad('В макете нет секций — сначала соберите его из каталога', 400)
      const template = findTemplate(body.template)
      const { doc: next, dropped } = relayoutDoc(doc, { ...(template?.options ?? {}), columns: body.columns ?? template?.options.columns })
      db.prepare('UPDATE menu_layouts SET doc_json=?, updated_at=?, rev=rev+1 WHERE id=?').run(
        JSON.stringify(next),
        Date.now(),
        id,
      )
      c.set('audit', { entity: 'menu-layout', entityId: String(id), summary: `Раскладка секций макета «${row.title}»` })
      return c.json({ ok: true, dropped, layout: layoutView(rowById(id)!) })
    },
  )

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
  /**
   * P3-2: что изменилось в каталоге — «было → стало» по ценам, названиям и фото.
   * Только чтение: ничего не пишем, пока владелец не выберет строки.
   */
  .get('/menu-layouts/:id/catalog-diff', (c) => {
    const id = Number(c.req.param('id'))
    const row = rowById(id)
    if (!row) throw bad('Макет не найден', 404)
    const doc = normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc()))
    const ids = doc.pages
      .flatMap((p) => p.blocks.filter((b) => b.type === 'product').map((b) => b.productId))
      .filter((n): n is number => typeof n === 'number')
    const catalog = loadCatalogProducts(ids)
    const changes: CatalogDiffRow[] = []
    doc.pages.forEach((page, pageIndex) => {
      for (const b of page.blocks) {
        if (b.type !== 'product' || b.productId == null) continue
        const live = catalog.get(b.productId) ?? null
        if (!live) {
          changes.push({
            blockId: b.id,
            pageId: page.id,
            pageIndex,
            productId: b.productId,
            title: b.titleOverride ?? b.snapshotName ?? `Товар #${b.productId}`,
            missing: true,
            price: null,
            name: null,
            photo: null,
            sizes: null,
            manualPrice: b.priceRubOverride != null,
          })
          continue
        }
        const livePrice = live.priceRub
        const price =
          b.priceRubOverride != null || b.snapshotPriceRub == null || b.snapshotPriceRub === livePrice
            ? null
            : { from: b.snapshotPriceRub, to: livePrice }
        const name =
          b.titleOverride != null || !b.snapshotName || b.snapshotName === live.name ? null : { from: b.snapshotName, to: live.name }
        const photo =
          b.photoUrlOverride != null || !b.snapshotImageUrl || b.snapshotImageUrl === live.imageUrl
            ? null
            : { from: b.snapshotImageUrl, to: live.imageUrl }
        const liveSizes = live.sizes.length > 1 ? live.sizes.map((sz) => `${sz.label}:${sz.priceRub ?? ''}`).join('|') : ''
        const snapSizes = (b.snapshotSizes ?? []).map((sz) => `${sz.label}:${sz.price ?? ''}`).join('|')
        const sizes = b.priceRubOverride != null || !snapSizes || snapSizes === liveSizes ? null : { from: snapSizes, to: liveSizes }
        if (!price && !name && !photo && !sizes) continue
        changes.push({
          blockId: b.id,
          pageId: page.id,
          pageIndex,
          productId: b.productId,
          title: b.titleOverride ?? live.name,
          missing: false,
          price,
          name,
          photo,
          sizes,
          manualPrice: b.priceRubOverride != null,
        })
      }
    })
    return c.json({ ok: true, changes, frozen: row.price_mode === 'frozen' })
  })

  .post('/menu-layouts/:id/sync-prices', async (c) => {
      requireWrite(c.get('adminRole' as never) as string | undefined)
      const id = Number(c.req.param('id'))
      const row = rowById(id)
      if (!row) throw bad('Макет не найден', 404)
      // Тело необязательно: старый клиент зовёт эндпоинт без него («обновить всё»).
      const body = (await c.req.json().catch(() => null)) as { blocks?: unknown } | null
      const only = Array.isArray(body?.blocks)
        ? body!.blocks.filter((b): b is string => typeof b === 'string' && b.length > 0 && b.length <= 64).slice(0, 500)
        : null
      const doc = normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc()))
      const { doc: fresh, changed } = snapshotDoc(doc)
      // P3-2: обновляем только выбранные строки. Остальные блоки остаются со своими
      // снапшотами — иначе «выборочное применение» тихо перезаписывало бы всё.
      const picked = only?.length ? new Set(only) : null
      const next = picked
        ? {
            ...doc,
            pages: doc.pages.map((page) => ({
              ...page,
              blocks: page.blocks.map((b) => {
                if (!picked.has(b.id)) return b
                const updated = fresh.pages.flatMap((p) => p.blocks).find((x) => x.id === b.id)
                return updated ?? b
              }),
            })),
          }
        : fresh
      const appliedBlocks = picked ? changed.filter((ch) => picked.has(ch.blockId)) : changed
      // frozen: снапшот — это и есть зафиксированные цены, их не переписываем молча.
      const applied = row.price_mode !== 'frozen'
      if (applied) {
        db.prepare('UPDATE menu_layouts SET doc_json=?, updated_at=? WHERE id=?').run(JSON.stringify(next), Date.now(), id)
      }
      c.set('audit', {
        entity: 'menu-layout',
        entityId: String(id),
        summary: applied
          ? `Макет меню: цены обновлены с каталога (${appliedBlocks.length}${picked ? ' выборочно' : ''})`
          : 'Макет меню: проверка цен каталога',
      })
      return c.json({ ok: true, applied, changed: appliedBlocks, layout: layoutView(rowById(id)!) })
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
          template: z.string().max(40).optional(),
          categoryIds: z.array(z.number().int().positive()).max(60).optional(),
        })
        .optional(),
    ),
    (c) => {
      requireWrite(c.get('adminRole' as never) as string | undefined)
      const id = Number(c.req.param('id'))
      const row = rowById(id)
      if (!row) throw bad('Макет не найден', 404)
      const body = (c.req.valid('json') ?? {}) as {
        pageId?: string
        replace?: boolean
        template?: string
        categoryIds?: number[]
      }
      const template = findTemplate(body.template)
      const wanted = body.categoryIds?.length ? new Set(body.categoryIds) : null

      const categories = db
        .prepare('SELECT id, name FROM categories WHERE available=1 ORDER BY sort_order, id')
        .all() as { id: number; name: string }[]
      const products = db
        .prepare(
          `SELECT id, name, price, category_id AS categoryId, image_url AS imageUrl,
                  variant_label AS variantLabel, group_id AS groupId, variant_sort AS variantSort
             FROM products WHERE available=1 ORDER BY sort_order, variant_sort, id`,
        )
        .all() as {
        id: number
        name: string
        price: number
        categoryId: number | null
        imageUrl: string | null
        variantLabel: string | null
        groupId: number | null
        variantSort: number | null
      }[]

      // Объёмы в каталоге — отдельные товары с общим group_id. На листе это одна позиция
      // («Капучино» с ценами 250 · 350 · 400), а не три почти одинаковых блока.
      const keyOf = (p: { id: number; groupId: number | null }): number => p.groupId ?? p.id
      const byKey = new Map<number, typeof products>()
      for (const p of products) {
        const list = byKey.get(keyOf(p)) ?? []
        list.push(p)
        byKey.set(keyOf(p), list)
      }

      const doc = migrateDocToCanvas(normalizeDoc(jsonParse<unknown>(row.doc_json, emptyDoc())))
      const targetPage = body.pageId ? doc.pages.find((p) => p.id === body.pageId) : doc.pages[0]
      if (!targetPage) throw bad('Страница не найдена', 404)

      // replace сбрасывает каталог (категории и позиции), но оставляет оформление листа.
      const keep = body.replace
        ? targetPage.blocks.filter((b) => b.type === 'logo' || b.type === 'text' || b.type === 'image' || b.type === 'divider')
        : [...targetPage.blocks]
      let skippedDuplicate = 0

      // Одна позиция (или группа объёмов) — один блок на весь макет:
      // повторная сборка не должна плодить «Капучино ×N».
      const productKey = new Map<number, number>()
      for (const p of products) productKey.set(Number(p.id), keyOf(p))
      const usedKeys = new Set<number>()
      for (const p of doc.pages) {
        const pageBlocks = p.id === targetPage.id ? keep : p.blocks
        for (const b of pageBlocks) {
          if (b.type === 'product' && !b.hidden && b.productId != null) {
            usedKeys.add(productKey.get(b.productId) ?? b.productId)
          }
        }
      }

      // Секции — семантический слой (schemaVersion 2), блоки получает движок раскладки.
      const sizes = loadCatalogSizes(products.map((x) => Number(x.id)))
      const groupSizes = loadGroupSizes(products.map((x) => x.groupId).filter((n): n is number => n != null))
      const sections: MenuSection[] = []
      let added = 0
      for (const cat of categories) {
        if (wanted && !wanted.has(cat.id)) continue
        const all = products.filter((p) => p.categoryId === cat.id)
        // Категория даёт ключи позиций: для группы объёмов это один ключ на все варианты.
        const keys = [...new Set(all.map(keyOf))]
        const freshKeys = keys.filter((k) => !usedKeys.has(k))
        const freshProducts = all.filter((p) => freshKeys.includes(keyOf(p)))
        skippedDuplicate += all.length - freshProducts.length
        if (freshKeys.length === 0) continue
        sections.push({
          id: `sec-${cat.id}`,
          title: cat.name,
          categoryId: cat.id,
          style: { showPhotos: true },
          items: freshKeys.map((k) => {
            const members = byKey.get(k) ?? []
            const p = members[0]!
            // Для группы объёмов берём общий список вариантов, для одиночного товара — его объёмы.
            const list = p.groupId != null ? groupSizes.get(Number(p.groupId)) ?? [] : sizes.get(Number(p.id)) ?? []
            added += 1
            usedKeys.add(k)
            return {
              id: `it-${p.id}`,
              productId: Number(p.id),
              groupId: p.groupId == null ? null : Number(p.groupId),
              titleOverride: null,
              description: null,
              badge: null,
              showPhoto: !!p.imageUrl,
              photoUrlOverride: null,
              hidden: false,
              sizes: list.map((sz) => ({
                label: sz.label,
                source: 'catalog' as const,
                productId: sz.productId,
                volumeItemId: sz.volumeItemId,
                priceRubOverride: null,
              })),
            }
          }),
        })
      }
      // Нечего добавлять — не трогаем updated_at, чтобы «Изменён» не врал.
      if (added === 0) {
        if (skippedDuplicate === 0) throw bad('В каталоге нет доступных позиций для сборки', 400)
        return c.json({ ok: true, added: 0, skippedDuplicate, layout: layoutView(rowById(id)!) })
      }

      const pinned = keep.map((b) => ({ ...b, pinned: true }))
      const flowed = flowSections({ sections, pinned, options: template?.options })
      // Секции живут рядом с блоками первой страницы: по ним кнопка «Пересобрать лист» и этап 3.
      const pages = flowed.pages.map((p, i) => (i === 0 ? { ...p, sections, ...(template ? { template: template.id } : {}) } : p))
      const nextDoc: MenuDoc = { schemaVersion: 2, pages }
      const themeJson = template ? JSON.stringify(normalizeTheme({ preset: template.theme })) : null
      db.prepare('UPDATE menu_layouts SET doc_json=?, theme_json=COALESCE(?, theme_json), updated_at=?, rev=rev+1 WHERE id=?').run(
        JSON.stringify(nextDoc),
        themeJson,
        Date.now(),
        id,
      )
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
    // CMYK — для типографии: цвета текста и плашек в DeviceCMYK.
    const cmyk = c.req.query('cmyk') === '1'
    // Замечания — аннотациями в PDF: правки видны прямо на листе.
    const withNotes = c.req.query('notes') === '1'
    // Спуск полос: a3-2, a3-4, a2-4 — сетка страниц на печатном листе.
    const impose = parseImpose(c.req.query('impose'))
    const metricsForImpose = formatMetrics(layout.format)
    const imposePlan = impose ? imposePlanFor(metricsForImpose.width, metricsForImpose.height, impose) : null
    // Блокируют экспорт только реальные ошибки данных. Проверки печатаемости (dpi, контраст)
    // и прочие notice — предупреждения: решение остаётся за человеком.
    const NON_BLOCKING = new Set(['notice', 'low_dpi', 'low_contrast'])
    const blocking = layout.blockers.filter((b) => !NON_BLOCKING.has(b.code))
    if (blocking.length > 0 && !force) {
      return c.json({ ok: false, error: 'has_blockers', blockers: layout.blockers, stats: layout.stats }, 409)
    }
    const pdf = await renderLayoutPdf(layout, { preset, bleedMm: bleed, cmyk, withNotes: withNotes && !impose, impose })
    const name = `menu-${layout.id}-${new Date().toISOString().slice(0, 10)}.pdf`
    c.set('audit', { entity: 'menu-layout', entityId: String(layout.id), summary: `Экспорт PDF макета «${layout.title}»` })
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Length': String(pdf.length),
        'Cache-Control': 'no-store',
        // Клиент показывает, что именно спущено и с каким масштабом.
        ...(imposePlan
          ? {
              'X-Impose-Sheet': imposePlan.sheet,
              'X-Impose-Grid': `${imposePlan.rows}x${imposePlan.cols}`,
              'X-Impose-Scale': imposePlan.scale.toFixed(3),
            }
          : {}),
      },
    })
  })

export type { LayoutView }
export { layoutView, rowById }

// ── P2-5: просмотр по ссылке ────────────────────────────────────────────
// Ссылка открывает макет только на чтение и не требует токена админки.
// Токен случайный (12 байт), отзыв — revoked_at: история остаётся, ссылка гаснет.

/** Строка «было → стало» для P3-2: считается из снапшотов документа и живого каталога. */
type CatalogDiffRow = {
  blockId: string
  pageId: string
  pageIndex: number
  productId: number
  title: string
  /** Позиции больше нет в каталоге — обновлять нечего, нужно решение человека. */
  missing: boolean
  price: { from: number | null; to: number | null } | null
  name: { from: string; to: string } | null
  photo: { from: string | null; to: string | null } | null
  sizes: { from: string; to: string } | null
  manualPrice: boolean
}

type ShareRow = { id: number; layout_id: number; token: string; note: string | null; created_at: number; revoked_at: number | null }

/** Случайный токен ссылки: 24 hex-символа — перебирать бессмысленно. */
function shareToken(): string {
  return randomBytes(12).toString('hex')
}

adminMenuLayouts
  .get('/menu-layouts/:id/shares', (c) => {
    const id = Number(c.req.param('id'))
    if (!rowById(id)) throw bad('Макет не найден', 404)
    const rows = db
      .prepare('SELECT * FROM menu_layout_shares WHERE layout_id=? ORDER BY created_at DESC')
      .all(id) as ShareRow[]
    return c.json({
      shares: rows.map((s) => ({
        id: s.id,
        token: s.token,
        note: s.note,
        createdAt: s.created_at,
        revokedAt: s.revoked_at,
        // Полная ссылка строится на клиенте: origin зависит от стенда.
        path: `#/share/${s.token}`,
      })),
    })
  })
  .post(
    '/menu-layouts/:id/shares',
    zValidator('json', z.object({ note: z.string().trim().max(120).optional() }).optional()),
    (c) => {
      requireWrite(c.get('adminRole' as never) as string | undefined)
      const id = Number(c.req.param('id'))
      const row = rowById(id)
      if (!row) throw bad('Макет не найден', 404)
      const note = c.req.valid('json')?.note ?? null
      const token = shareToken()
      const info = db
        .prepare('INSERT INTO menu_layout_shares(layout_id, token, note, created_at) VALUES(?,?,?,?)')
        .run(id, token, note, Date.now())
      c.set('audit', { entity: 'menu-layout', entityId: String(id), summary: `Ссылка на просмотр макета «${row.title}» создана` })
      return c.json({ share: { id: Number(info.lastInsertRowid), token, note, path: `#/share/${token}` } })
    },
  )
  .delete('/menu-layouts/:id/shares/:shareId', (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const id = Number(c.req.param('id'))
    const shareId = Number(c.req.param('shareId'))
    const share = db.prepare('SELECT * FROM menu_layout_shares WHERE id=? AND layout_id=?').get(shareId, id) as ShareRow | undefined
    if (!share) throw bad('Ссылка не найдена', 404)
    if (!share.revoked_at) {
      db.prepare('UPDATE menu_layout_shares SET revoked_at=? WHERE id=?').run(Date.now(), shareId)
      c.set('audit', { entity: 'menu-layout', entityId: String(id), summary: 'Ссылка на просмотр макета отозвана' })
    }
    return c.json({ ok: true })
  })

