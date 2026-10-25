/**
 * Заголовок контента необязателен: верхний баннер и часть материалов идут без текста.
 * Пустой заголовок не подменяется именем файла, ID или чем-то ещё.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-promo-title-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const { runMigrations } = await import('../db/migrate')
const { app } = await import('../app')

const admin = (method: string, path: string, body?: unknown) =>
  app.request(`/api/admin${path}`, {
    method,
    headers: { 'X-Admin-Token': 'test-admin', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeAll(() => {
  runMigrations(db)
})

describe('content without a title', () => {
  it('creates a promo with no title at all', async () => {
    const r = await admin('POST', '/promos', {
      body: 'Фон шапки',
      placement: 'home_hero',
      status: 'published',
      imageUrl: '/uploads/hero.webp',
    })
    expect(r.status).toBe(200)
    const row = db.prepare(`SELECT title, body, placement, status FROM promos ORDER BY id DESC LIMIT 1`).get() as any
    expect(row.title).toBe('')
    expect(row.body).toBe('Фон шапки')
    expect(row.placement).toBe('home_hero')
  })

  it('creates a promo with an explicitly empty title', async () => {
    const r = await admin('POST', '/promos', { title: '', body: 'Подпись', placement: 'home_feature', status: 'published' })
    expect(r.status).toBe(200)
    const row = db.prepare(`SELECT title FROM promos ORDER BY id DESC LIMIT 1`).get() as any
    expect(row.title).toBe('')
  })

  it('keeps an existing title when it is not part of the patch', async () => {
    const created = db.prepare(`SELECT id FROM promos ORDER BY id DESC LIMIT 1`).get() as { id: number }
    await admin('PATCH', `/promos/${created.id}`, { body: 'Новая подпись' })
    const row = db.prepare('SELECT title, body FROM promos WHERE id=?').get(created.id) as any
    expect(row.title).toBe('')
    expect(row.body).toBe('Новая подпись')
  })

  it('still accepts and returns a filled title', async () => {
    const r = await admin('POST', '/promos', { title: 'Новинка', body: 'Раф', status: 'published', placement: 'home_feature' })
    expect(r.status).toBe(200)
    const row = db.prepare(`SELECT title FROM promos ORDER BY id DESC LIMIT 1`).get() as any
    expect(row.title).toBe('Новинка')
  })

  it('rejects an over-long title instead of storing it', async () => {
    const r = await admin('POST', '/promos', { title: 'x'.repeat(81) })
    expect(r.status).toBe(400)
  })
})
