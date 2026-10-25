/**
 * Эвотор недоступен → страница «Касса» должна открываться на кэше точек,
 * иначе настройку меню (она по каждой кассе) не открыть.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-stores-fallback-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
delete process.env.EVOTOR_API_TOKEN

const { db } = await import('../db')
const { runMigrations } = await import('../db/migrate')
const { app } = await import('../app')

beforeAll(() => {
  runMigrations(db)
})

const get = () =>
  app.request('/api/admin/evotor/stores', { headers: { 'X-Admin-Token': 'test-admin' } })

describe('GET /evotor/stores without Evotor', () => {
  it('answers 502 when there is nothing cached', async () => {
    db.prepare('DELETE FROM evotor_stores').run()
    const r = await get()
    expect(r.status).toBe(502)
  })

  it('falls back to cached stores and marks the answer as stale', async () => {
    db.prepare(`INSERT INTO evotor_stores(store_uuid,name,address,sync_enabled,updated_at)
                VALUES('store-cache','Точка из кэша','Ленина 1',1,1)
                ON CONFLICT(store_uuid) DO UPDATE SET name=excluded.name`).run()
    const r = await get()
    expect(r.status).toBe(200)
    const j = (await r.json()) as any
    expect(j.stale).toBe(true)
    expect(typeof j.error).toBe('string')
    expect(j.stores).toHaveLength(1)
    expect(j.stores[0]).toMatchObject({ uuid: 'store-cache', name: 'Точка из кэша', syncEnabled: true })
  })
})
