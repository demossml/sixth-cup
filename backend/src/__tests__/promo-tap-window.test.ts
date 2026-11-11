/**
 * CON-1: у акции настраивается действие по тапу и окно показа по времени суток.
 *
 *  • tap_action: 'modal' (описание в окне), 'product' (перейти к товару), 'menu';
 *  • time_from / time_to — минуты от полуночи, null+null = показывать всегда;
 *  • окно отдаётся гостю в /api/directory, чтобы PWA могла фильтровать по часам
 *    телефона даже из кэша (без сети).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-promo-tap-'))
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

const lastPromo = () =>
  db.prepare(`SELECT id, tap_action AS tapAction, time_from AS timeFrom, time_to AS timeTo,
                     placement, status FROM promos ORDER BY id DESC LIMIT 1`).get() as {
    id: number; tapAction: string; timeFrom: number | null; timeTo: number | null
    placement: string; status: string
  }

beforeAll(() => {
  runMigrations(db)
  db.prepare('DELETE FROM promos').run()
})

describe('действие по тапу', () => {
  it('по умолчанию — описание в окне', async () => {
    expect((await admin('POST', '/promos', { title: 'Утро', placement: 'home_feature', status: 'published' })).status).toBe(200)
    expect(lastPromo().tapAction).toBe('modal')
  })

  it('переход к товару сохраняется вместе с product_id', async () => {
    const r = await admin('POST', '/promos', {
      title: 'Раф', placement: 'home_feature', status: 'published',
      tapAction: 'product', productId: 42,
    })
    expect(r.status).toBe(200)
    const row = lastPromo()
    expect(row.tapAction).toBe('product')
    expect((db.prepare('SELECT product_id AS p FROM promos WHERE id=?').get(row.id) as { p: number }).p).toBe(42)
  })

  it('неизвестное действие отклоняется', async () => {
    const r = await admin('POST', '/promos', { title: 'X', tapAction: 'pay' })
    expect(r.status).toBe(400)
  })

  it('патч меняет действие, не трогая остальное', async () => {
    const { id } = lastPromo()
    const r = await admin('PATCH', `/promos/${id}`, { tapAction: 'menu' })
    expect(r.status).toBe(200)
    const row = lastPromo()
    expect(row.tapAction).toBe('menu')
    expect(row.placement).toBe('home_feature')
  })
})

describe('окно показа по времени', () => {
  it('сохраняет границы утреннего окна', async () => {
    expect((await admin('POST', '/promos', {
      title: 'Утренний кофе', placement: 'home_feature', status: 'published',
      timeFrom: 420, timeTo: 720,
    })).status).toBe(200)
    const row = lastPromo()
    expect(row.timeFrom).toBe(420)
    expect(row.timeTo).toBe(720)
  })

  it('без границ — показ круглосуточный', async () => {
    expect((await admin('POST', '/promos', { title: 'Всегда', placement: 'home_feature', status: 'published' })).status).toBe(200)
    const row = lastPromo()
    expect(row.timeFrom).toBeNull()
    expect(row.timeTo).toBeNull()
  })

  it('границы можно снять патчем', async () => {
    expect((await admin('POST', '/promos', {
      title: 'Обед', placement: 'home_feature', status: 'published', timeFrom: 720, timeTo: 1020,
    })).status).toBe(200)
    const { id } = lastPromo()
    await admin('PATCH', `/promos/${id}`, { timeFrom: null, timeTo: null })
    const row = lastPromo()
    expect(row.timeFrom).toBeNull()
    expect(row.timeTo).toBeNull()
  })

  it('отклоняет минуты вне суток', async () => {
    expect((await admin('POST', '/promos', { title: 'X', timeFrom: -1 })).status).toBe(400)
    expect((await admin('POST', '/promos', { title: 'X', timeTo: 1440 })).status).toBe(400)
  })
})

describe('гостевая выдача', () => {
  it('отдаёт действие тапа и окно вместе с контентом', async () => {
    expect((await admin('POST', '/promos', {
      title: 'Вечер', placement: 'home_feature', status: 'published',
      tapAction: 'product', productId: 7, timeFrom: 1020, timeTo: 1380,
    })).status).toBe(200)

    const r = await app.request('/api/directory')
    expect(r.status).toBe(200)
    const body = (await r.json()) as { content: Array<Record<string, unknown>> }
    const item = body.content.find((x) => x.title === 'Вечер')
    expect(item).toBeTruthy()
    expect(item!.tapAction).toBe('product')
    expect(item!.timeFrom).toBe(1020)
    expect(item!.timeTo).toBe(1380)
    expect(item!.productId).toBe(7)
  })
})
