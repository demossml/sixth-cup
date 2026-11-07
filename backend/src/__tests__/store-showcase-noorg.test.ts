/**
 * Витрина точки на «чистой» базе: организаций нет вообще.
 * Юрлица приходят из Эвотора, поэтому создание точки не должно требовать справочника.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-store-noorg-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { config } = await import('../config')
const { db } = await import('../db')

const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const adm = async (m: string, p: string, b?: unknown) => {
  const r = await app.request('/api/admin' + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, j: (await r.json().catch(() => ({}))) as any }
}

describe('витрина без организаций', () => {
  it('организаций нет — точка создаётся', async () => {
    expect((db.prepare('SELECT COUNT(*) AS n FROM organizations').get() as { n: number }).n).toBe(0)
    const created = await adm('POST', '/stores', { name: '6.7 Coffee на Багратиона', address: 'ул. Багратиона, 7' })
    expect(created.s).toBe(200)
    const row = db.prepare('SELECT organization_id AS org, name, address FROM stores WHERE id=?').get(Number(created.j.id)) as any
    expect(row).toMatchObject({ org: null, name: '6.7 Coffee на Багратиона', address: 'ул. Багратиона, 7' })
  })

  it('витрина из облачной точки без организаций', async () => {
    db.prepare(`INSERT INTO evotor_stores(store_uuid,name,address,code,updated_at,sync_enabled) VALUES(?,?,?,?,?,0)`)
      .run('uuid-noorg-1', 'Точка 1', 'Измайловский Вал, 2', '1', Date.now())
    const made = await adm('POST', '/evotor/stores/uuid-noorg-1/showcase')
    expect(made.s).toBe(200)
    expect(made.j.created).toBe(true)
    const row = db.prepare('SELECT organization_id AS org, name, address, evotor_name AS evotorName FROM stores WHERE id=?')
      .get(Number(made.j.storeId)) as any
    expect(row).toMatchObject({ org: null, name: 'Точка 1', address: 'Измайловский Вал, 2', evotorName: 'Точка 1' })
  })
})
