/**
 * Палитры бренда и версии макета меню.
 *
 * Палитра — это набор цветов на аккаунт: один бренд, одинаковые цвета во всех макетах.
 * Версия — снимок документа и темы; к нему можно вернуться, если правки увели лист
 * «не туда». Каталог, касса и меню гостя здесь не затрагиваются.
 */
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { normalizeDoc, normalizeTheme } from './menuLayoutDoc'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../../config'

type Env = { Variables: { audit?: { entity: string; entityId: string; summary: string } } }

const requireWrite = (role: string | undefined) => {
  if (role === 'viewer') throw bad('Read-only admin token', 403)
}

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i

const paletteZ = z.object({
  name: z.string().trim().min(1).max(60),
  colors: z.array(z.string().regex(HEX, 'Цвет — только HEX')).min(1).max(12),
})

type PaletteRow = { id: number; name: string; colors_json: string; created_at: number; updated_at: number }

const paletteView = (r: PaletteRow) => ({
  id: Number(r.id),
  name: r.name,
  colors: (() => {
    try {
      const list = JSON.parse(r.colors_json) as unknown
      return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string') : []
    } catch {
      return []
    }
  })(),
  updatedAt: Number(r.updated_at),
})

type VersionRow = {
  id: number
  layout_id: number
  rev: number
  title: string
  note: string | null
  theme_json: string
  doc_json: string
  created_at: number
}

const versionMeta = (r: VersionRow) => {
  let blocks = 0
  let pages = 0
  try {
    const doc = normalizeDoc(JSON.parse(r.doc_json) as unknown)
    pages = doc.pages.length
    blocks = doc.pages.reduce((n, p) => n + p.blocks.length, 0)
  } catch {
    /* битый снимок не должен ломать список */
  }
  return {
    id: Number(r.id),
    rev: Number(r.rev),
    title: r.title,
    note: r.note,
    createdAt: Number(r.created_at),
    pages,
    blocks,
  }
}

type FontRow = { id: number; family: string; regular_key: string; bold_key: string | null; created_at: number }

const fontView = (r: FontRow) => ({
  id: Number(r.id),
  family: r.family,
  url: `/uploads/${r.regular_key}`,
  boldUrl: r.bold_key ? `/uploads/${r.bold_key}` : null,
  createdAt: Number(r.created_at),
})

const FONT_MIME: Record<string, string> = {
  'font/ttf': '.ttf',
  'font/otf': '.otf',
  'font/woff': '.woff',
  'font/woff2': '.woff2',
  'application/font-woff': '.woff',
  'application/x-font-ttf': '.ttf',
  'application/octet-stream': '', // тип может не прийти от браузера — проверим по сигнатуре
}

/** Проверка шрифта: парсится, есть кириллица и знак рубля, иначе в печати будут квадраты. */
async function inspectFont(buf: Buffer): Promise<{ family: string; ext: string } | { error: string }> {
  const head = buf.subarray(0, 4).toString('latin1')
  const ext = head === 'wOFF' ? '.woff' : head === 'wOF2' ? '.woff2' : head === 'OTTO' ? '.otf' : '\u0000\u0001\u0000\u0000' === head ? '.ttf' : ''
  const resolved = ext || (head.charCodeAt(0) === 0 && head.charCodeAt(1) === 1 ? '.ttf' : '')
  if (!resolved) return { error: 'Это не файл шрифта (ожидается TTF, OTF, WOFF или WOFF2)' }
  try {
    // Через createRequire: у fontkit нет типов, а объявлять модуль глобально
    // пришлось бы и для клиентских сборок, которые его не используют.
    const fontkit = createRequire(import.meta.url)('fontkit') as {
      create: (b: Buffer) => { familyName?: string; hasGlyphForCodePoint: (cp: number) => boolean }
    }
    const font = fontkit.create(buf)
    const family = String(font.familyName ?? '').trim().slice(0, 60)
    if (!family) return { error: 'В шрифте не указано имя семейства' }
    const need = ['Ж', 'ё', '₽']
    const missing = need.filter((ch) => !font.hasGlyphForCodePoint(ch.codePointAt(0)!))
    if (missing.length) return { error: `В шрифте нет символов: ${missing.join(' ')} — нужна кириллица и ₽` }
    return { family, ext: resolved }
  } catch {
    return { error: 'Не удалось разобрать шрифт — возможно, файл повреждён' }
  }
}

export const adminMenuAssets = new Hono<Env>()
  /* ── свои шрифты ──────────────────────────────────────────── */
  .get('/menu-fonts', (c) => {
    const rows = db.prepare('SELECT * FROM menu_fonts ORDER BY created_at DESC').all() as FontRow[]
    return c.json({ ok: true, fonts: rows.map(fontView) })
  })

  .post('/menu-fonts', bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json({ error: 'Файл больше 8 МБ' }, 413) }), async (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const body = await c.req.parseBody({ all: true })
    const regular = body['file']
    if (!regular || typeof regular === 'string') throw bad('Нужен файл шрифта в поле «file»', 400)
    const bold = body['bold']
    const regularBuf = Buffer.from(await (regular as File).arrayBuffer())
    const checked = await inspectFont(regularBuf)
    if ('error' in checked) throw bad(checked.error, 400)
    if (regularBuf.length > 8 * 1024 * 1024) throw bad('Шрифт больше 8 МБ', 400)

    const existing = db.prepare('SELECT * FROM menu_fonts WHERE family=?').get(checked.family) as FontRow | undefined
    if (existing) throw bad(`Шрифт «${checked.family}» уже загружен`, 409)

    mkdirSync(config.uploadsDir, { recursive: true })
    const prefix = `${Date.now()}-${randomBytes(6).toString('hex')}`
    const regularKey = `font-${prefix}${checked.ext}`
    writeFileSync(join(config.uploadsDir, regularKey), regularBuf)

    let boldKey: string | null = null
    if (bold && typeof bold !== 'string') {
      const boldBuf = Buffer.from(await (bold as File).arrayBuffer())
      const boldChecked = await inspectFont(boldBuf)
      if ('error' in boldChecked) throw bad(`Жирное начертание: ${boldChecked.error}`, 400)
      boldKey = `font-${prefix}-bold${boldChecked.ext}`
      writeFileSync(join(config.uploadsDir, boldKey), boldBuf)
    }

    const now = Date.now()
    const info = db
      .prepare('INSERT INTO menu_fonts(family, regular_key, bold_key, created_at) VALUES(?,?,?,?)')
      .run(checked.family, regularKey, boldKey, now)
    const row = db.prepare('SELECT * FROM menu_fonts WHERE id=?').get(Number(info.lastInsertRowid)) as FontRow
    c.set('audit', { entity: 'menu-font', entityId: String(row.id), summary: `Загружен шрифт «${row.family}»` })
    return c.json({ ok: true, font: fontView(row) }, 201)
  })

  .delete('/menu-fonts/:id', (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const id = Number(c.req.param('id'))
    const row = db.prepare('SELECT * FROM menu_fonts WHERE id=?').get(id) as FontRow | undefined
    if (!row) throw bad('Шрифт не найден', 404)
    db.prepare('DELETE FROM menu_fonts WHERE id=?').run(id)
    c.set('audit', { entity: 'menu-font', entityId: String(id), summary: `Шрифт «${row.family}» удалён` })
    return c.json({ ok: true })
  })
  /* ── палитры бренда ───────────────────────────────────────── */
  .get('/menu-palettes', (c) => {
    const rows = db.prepare('SELECT * FROM menu_palettes ORDER BY updated_at DESC').all() as PaletteRow[]
    return c.json({ ok: true, palettes: rows.map(paletteView) })
  })

  .post('/menu-palettes', zValidator('json', paletteZ), (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const body = c.req.valid('json') as z.infer<typeof paletteZ>
    const colors = body.colors.map((x) => x.toUpperCase())
    const now = Date.now()
    const info = db
      .prepare('INSERT INTO menu_palettes(name, colors_json, created_at, updated_at) VALUES(?,?,?,?)')
      .run(body.name, JSON.stringify(colors), now, now)
    const row = db.prepare('SELECT * FROM menu_palettes WHERE id=?').get(Number(info.lastInsertRowid)) as PaletteRow
    c.set('audit', { entity: 'menu-palette', entityId: String(row.id), summary: `Палитра «${row.name}» создана` })
    return c.json({ ok: true, palette: paletteView(row) }, 201)
  })

  .put('/menu-palettes/:id', zValidator('json', paletteZ.partial()), (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const id = Number(c.req.param('id'))
    const row = db.prepare('SELECT * FROM menu_palettes WHERE id=?').get(id) as PaletteRow | undefined
    if (!row) throw bad('Палитра не найдена', 404)
    const body = c.req.valid('json') as Partial<z.infer<typeof paletteZ>>
    const name = body.name ?? row.name
    const colors = body.colors ? body.colors.map((x) => x.toUpperCase()) : paletteView(row).colors
    db.prepare('UPDATE menu_palettes SET name=?, colors_json=?, updated_at=? WHERE id=?').run(
      name,
      JSON.stringify(colors),
      Date.now(),
      id,
    )
    const next = db.prepare('SELECT * FROM menu_palettes WHERE id=?').get(id) as PaletteRow
    c.set('audit', { entity: 'menu-palette', entityId: String(id), summary: `Палитра «${next.name}» обновлена` })
    return c.json({ ok: true, palette: paletteView(next) })
  })

  .delete('/menu-palettes/:id', (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const id = Number(c.req.param('id'))
    const row = db.prepare('SELECT * FROM menu_palettes WHERE id=?').get(id) as PaletteRow | undefined
    if (!row) throw bad('Палитра не найдена', 404)
    db.prepare('DELETE FROM menu_palettes WHERE id=?').run(id)
    c.set('audit', { entity: 'menu-palette', entityId: String(id), summary: `Палитра «${row.name}» удалена` })
    return c.json({ ok: true })
  })

  /* ── версии макета ────────────────────────────────────────── */
  .get('/menu-layouts/:id/versions', (c) => {
    const id = Number(c.req.param('id'))
    const rows = db
      .prepare('SELECT * FROM menu_layout_versions WHERE layout_id=? ORDER BY created_at DESC LIMIT 50')
      .all(id) as VersionRow[]
    return c.json({ ok: true, versions: rows.map(versionMeta) })
  })

  .post(
    '/menu-layouts/:id/versions',
    zValidator('json', z.object({ note: z.string().trim().max(120).optional() }).optional()),
    (c) => {
      requireWrite(c.get('adminRole' as never) as string | undefined)
      const id = Number(c.req.param('id'))
      const layout = db.prepare('SELECT * FROM menu_layouts WHERE id=?').get(id) as
        | { id: number; title: string; rev: number; theme_json: string; doc_json: string }
        | undefined
      if (!layout) throw bad('Макет не найден', 404)
      const body = (c.req.valid('json') ?? {}) as { note?: string }
      const info = db
        .prepare(
          `INSERT INTO menu_layout_versions(layout_id, rev, title, note, theme_json, doc_json, created_at)
           VALUES(?,?,?,?,?,?,?)`,
        )
        .run(id, layout.rev, layout.title, body.note ?? null, layout.theme_json, layout.doc_json, Date.now())
      const row = db
        .prepare('SELECT * FROM menu_layout_versions WHERE id=?')
        .get(Number(info.lastInsertRowid)) as VersionRow
      c.set('audit', { entity: 'menu-layout', entityId: String(id), summary: `Версия макета «${layout.title}» сохранена` })
      return c.json({ ok: true, version: versionMeta(row) }, 201)
    },
  )

  /** Вернуться к версии: снимок становится текущим документом, rev растёт. */
  .post('/menu-layouts/:id/versions/:vid/restore', (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const id = Number(c.req.param('id'))
    const vid = Number(c.req.param('vid'))
    const layout = db.prepare('SELECT * FROM menu_layouts WHERE id=?').get(id) as { id: number; title: string } | undefined
    if (!layout) throw bad('Макет не найден', 404)
    const version = db
      .prepare('SELECT * FROM menu_layout_versions WHERE id=? AND layout_id=?')
      .get(vid, id) as VersionRow | undefined
    if (!version) throw bad('Версия не найдена', 404)

    // Сначала сохраняем текущее состояние, чтобы откат тоже можно было отменить.
    const current = db.prepare('SELECT * FROM menu_layouts WHERE id=?').get(id) as {
      rev: number
      title: string
      theme_json: string
      doc_json: string
    }
    db.prepare(
      `INSERT INTO menu_layout_versions(layout_id, rev, title, note, theme_json, doc_json, created_at)
       VALUES(?,?,?,?,?,?,?)`,
    ).run(id, current.rev, current.title, 'перед откатом', current.theme_json, current.doc_json, Date.now())

    db.prepare('UPDATE menu_layouts SET title=?, theme_json=?, doc_json=?, updated_at=?, rev=rev+1 WHERE id=?').run(
      version.title,
      version.theme_json,
      version.doc_json,
      Date.now(),
      id,
    )
    c.set('audit', { entity: 'menu-layout', entityId: String(id), summary: `Макет возвращён к версии от ${new Date(version.created_at).toLocaleString('ru-RU')}` })
    return c.json({ ok: true })
  })

  .delete('/menu-layouts/:id/versions/:vid', (c) => {
    requireWrite(c.get('adminRole' as never) as string | undefined)
    const id = Number(c.req.param('id'))
    const vid = Number(c.req.param('vid'))
    const info = db.prepare('DELETE FROM menu_layout_versions WHERE id=? AND layout_id=?').run(vid, id)
    if (info.changes === 0) throw bad('Версия не найдена', 404)
    c.set('audit', { entity: 'menu-layout', entityId: String(id), summary: 'Версия макета удалена' })
    return c.json({ ok: true })
  })

/** Проверка темы при откате: битый снимок не должен ломать макет. */
export const safeTheme = (json: string): ReturnType<typeof normalizeTheme> => {
  try {
    return normalizeTheme(JSON.parse(json))
  } catch {
    return normalizeTheme({})
  }
}
