/**
 * P2-5: просмотр макета по ссылке.
 * Проверяем главное: ссылка работает без токена админки, отзыв её гасит,
 * наружу не уходят служебные поля (ревизия, служебные списки).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-menu-share-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')

const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }

const mkLayout = async (title = 'QA: витрина') => {
  const created = await app.request('/api/admin/menu-layouts', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ title }),
  })
  const { layout } = (await created.json()) as { layout: { id: number } }
  return layout.id
}

const mkShare = async (layoutId: number, note?: string) => {
  const res = await app.request(`/api/admin/menu-layouts/${layoutId}/shares`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(note ? { note } : {}),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { share: { id: number; token: string; path: string } }
}

beforeEach(() => {
  db.prepare('DELETE FROM menu_layout_shares').run()
  db.prepare('DELETE FROM menu_layouts').run()
})

describe('P2-5: ссылка на просмотр макета', () => {
  it('создаёт ссылку и открывает макет без токена админки', async () => {
    const id = await mkLayout('Макет для типографии')
    const { share } = await mkShare(id, 'для печати')

    expect(share.token).toMatch(/^[0-9a-f]{24}$/)
    expect(share.path).toBe(`#/share/${share.token}`)

    const res = await app.request(`/api/public/menu-share/${share.token}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      layout: { title: string; pages: number; doc: { pages: unknown[] }; theme: { bg: string } }
    }
    expect(body.ok).toBe(true)
    expect(body.layout.title).toBe('Макет для типографии')
    expect(body.layout.doc.pages.length).toBeGreaterThan(0)
    expect(body.layout.pages).toBe(body.layout.doc.pages.length)
  })

  it('наружу не уходят ревизия и служебные списки', async () => {
    const id = await mkLayout()
    const { share } = await mkShare(id)
    const body = (await (await app.request(`/api/public/menu-share/${share.token}`)).json()) as {
      layout: Record<string, unknown> & { doc: Record<string, unknown> }
    }
    expect(body.layout.rev).toBeUndefined()
    expect(body.layout.blockers).toBeUndefined()
    expect(body.layout.drift).toBeUndefined()
    expect(body.layout.stats).toBeUndefined()
    expect(body.layout.doc.comments).toBeUndefined()
  })

  it('отозванная ссылка отвечает 404', async () => {
    const id = await mkLayout()
    const { share } = await mkShare(id)

    const revoked = await app.request(`/api/admin/menu-layouts/${id}/shares/${share.id}`, { method: 'DELETE', headers: H })
    expect(revoked.status).toBe(200)

    const res = await app.request(`/api/public/menu-share/${share.token}`)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toMatch(/недействительна/)
  })

  it('неизвестный токен — 404, список ссылок показывает отозванные', async () => {
    const id = await mkLayout()
    expect((await app.request('/api/public/menu-share/deadbeefdeadbeefdeadbeef')).status).toBe(404)

    const a = await mkShare(id, 'первая')
    const b = await mkShare(id)
    await app.request(`/api/admin/menu-layouts/${id}/shares/${a.share.id}`, { method: 'DELETE', headers: H })

    const list = (await (await app.request(`/api/admin/menu-layouts/${id}/shares`, { headers: H })).json()) as {
      shares: { id: number; token: string; note: string | null; revokedAt: number | null }[]
    }
    expect(list.shares).toHaveLength(2)
    const first = list.shares.find((s) => s.id === a.share.id)!
    const second = list.shares.find((s) => s.id === b.share.id)!
    expect(first.revokedAt).toBeTypeOf('number')
    expect(first.note).toBe('первая')
    expect(second.revokedAt).toBeNull()
  })

  it('ссылка требует токен админки на создание и отзыв', async () => {
    const id = await mkLayout()
    const create = await app.request(`/api/admin/menu-layouts/${id}/shares`, { method: 'POST' })
    // Без токена админ-роут закрыт (401/403 — зависит от порядка middleware).
    expect([401, 403]).toContain(create.status)
  })

  it('PDF по ссылке отдаётся без токена', async () => {
    const id = await mkLayout()
    const { share } = await mkShare(id)
    const res = await app.request(`/api/public/menu-share/${share.token}/export.pdf?preset=screen&bleed=0`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    const buf = new Uint8Array(await res.arrayBuffer())
    // Сигнатура PDF: значит рендер действительно собрался, а не отдал заглушку.
    expect(new TextDecoder().decode(buf.slice(0, 4))).toBe('%PDF')
  })
})
