/**
 * Палитры бренда и версии макета меню.
 *
 * Палитра — это набор цветов на аккаунт: один бренд, одинаковые цвета во всех макетах.
 * Версия — снимок документа и темы; к нему можно вернуться, если правки увели лист
 * «не туда». Каталог, касса и меню гостя здесь не затрагиваются.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { normalizeDoc, normalizeTheme } from './menuLayoutDoc'

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

export const adminMenuAssets = new Hono<Env>()
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
