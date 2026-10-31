import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-evpurge-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.ADMIN_MARKETER_TOKEN = 'mgr-token'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { config } = await import('../config')
const { ProductPushService } = await import('../integrations/evotor/sync/ProductPushService')
const { tryLock, unlock, lockKey, resetLocks } = await import('../lib/storeLocks')

const STORE = '20261017-AD69-40F0-80D2-3C027B1A4BF8'
const ownH = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
const mgrH = { 'X-Admin-Token': 'mgr-token', 'content-type': 'application/json' }

function storeRow(paused = 0) {
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, sync_enabled) VALUES(?,?,1)
     ON CONFLICT(store_uuid) DO UPDATE SET sync_enabled=1, catalog_paused=?`,
  ).run(STORE, 'Бухгалтерион', paused)
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,available,counts_as_cup) VALUES(990,'Латте',250,1,1)`).run()
  db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(990,?,?)')
    .run(STORE, 'remote-latte')
  db.prepare(
    `INSERT OR REPLACE INTO evotor_products(product_id,variant,store_uuid,evotor_uuid,last_hash,last_synced_at,status)
     VALUES(990,'',?,'remote-latte','h',?, 'SYNCED')`,
  ).run(STORE, Date.now())
  db.prepare(
    `INSERT INTO evotor_outbox(store_uuid,entity,entity_key,op,payload_hash,priority,status,attempts,next_at)
     VALUES(?,'PRODUCT','990','UPSERT','h',5,'PENDING',0,?)`,
  ).run(STORE, Date.now())
}

function fakeClient(opts: { failId?: string; listError?: boolean } = {}) {
  const calls: { deleted: string[] } = { deleted: [] }
  const client = {
    isConfigured: true,
    getStores: async () => ({ items: [{ uuid: STORE, name: 'Бухгалтерион' }] }),
    getProducts: async () => {
      if (opts.listError) throw new Error('status=500 list failed')
      return [
        { id: 'p1', name: 'Латте', articleNumber: 'sc-990' },
        { id: 'p2', name: 'Круассан' },
        { id: 'g1', name: 'Напитки', group: true },
      ]
    },
    deleteCloudProducts: async (_store: string, ids: string[]) => {
      if (opts.failId && ids.length === 3) throw new Error('status=400 batch')
      if (opts.failId && ids.includes(opts.failId)) throw new Error(`status=400 ${opts.failId}`)
      calls.deleted.push(...ids)
      return { deleted: ids.length }
    },
  }
  return { client: client as any, calls }
}

const paused = (): number =>
  (db.prepare('SELECT COALESCE(catalog_paused,0) AS p FROM evotor_stores WHERE store_uuid=?').get(STORE) as { p: number }).p

beforeEach(() => {
  resetLocks()
  storeRow()
})

describe('purgeCloudCatalog (сервис)', () => {
  it('удаляет все товары и группы, чистит локальный трекинг, ставит паузу', async () => {
    const { client, calls } = fakeClient()
    const svc = new ProductPushService(db, client)
    const r = await svc.purgeCloudCatalog(STORE)

    expect(r.deleted).toBe(3)
    expect(r.listed).toBe(3)
    expect(r.groups).toBe(1)
    expect(r.deleteErrors).toEqual([])
    expect(calls.deleted.sort()).toEqual(['g1', 'p1', 'p2'])

    expect(db.prepare('SELECT COUNT(*) AS n FROM product_store_links WHERE store_uuid=?').get(STORE)).toEqual({ n: 0 })
    const prods = db.prepare(`SELECT COUNT(*) AS n FROM evotor_products WHERE store_uuid=?`).get(STORE) as { n: number }
    expect(prods.n).toBe(0)
    const outbox = db.prepare(`SELECT COUNT(*) AS n FROM evotor_outbox WHERE store_uuid=? AND entity='PRODUCT'`).get(STORE) as { n: number }
    expect(outbox.n).toBe(0)
    expect(paused()).toBe(1)
    // локальный каталог 6.7 цел
    expect(db.prepare('SELECT COUNT(*) AS n FROM products WHERE id=990').get()).toEqual({ n: 1 })
    // синхронизация чеков не выключена
    const st = db.prepare('SELECT sync_enabled AS e FROM evotor_stores WHERE store_uuid=?').get(STORE) as { e: number }
    expect(st.e).toBe(1)
  })

  it('частичный отказ: остальные позиции удаляются, ошибка попадает в список', async () => {
    const { client } = fakeClient({ failId: 'p2' })
    const r = await new ProductPushService(db, client).purgeCloudCatalog(STORE)
    expect(r.deleted).toBe(2)
    expect(r.deleteErrors.join(' ')).toContain('p2')
  })

  it('ошибка списка: ничего не удалено и пауза не ставится', async () => {
    const { client } = fakeClient({ listError: true })
    const r = await new ProductPushService(db, client).purgeCloudCatalog(STORE)
    expect(r.deleted).toBe(0)
    expect(r.deleteErrors[0]).toMatch(/^list:/)
    expect(paused()).toBe(0)
  })

  it('явная выгрузка возобновляет автовыгрузку (пауза снимается)', async () => {
    db.prepare('UPDATE evotor_stores SET catalog_paused=1 WHERE store_uuid=?').run(STORE)
    const svc = new ProductPushService(db, {
      isConfigured: false,
      getProducts: async () => [],
    } as any)
    await svc.pushToStore(STORE)
    expect(paused()).toBe(0)
  })
})

describe('POST /purge-catalog', () => {
  it('manager и viewer получают 403', async () => {
    const r = await app.request(`/api/admin/evotor/stores/${STORE}/purge-catalog`, {
      method: 'POST', headers: mgrH, body: JSON.stringify({ confirm: 'удалить' }),
    })
    expect(r.status).toBe(403)
  })

  it('требует слово «удалить»', async () => {
    const r = await app.request(`/api/admin/evotor/stores/${STORE}/purge-catalog`, {
      method: 'POST', headers: ownH, body: JSON.stringify({ confirm: 'нет' }),
    })
    expect(r.status).toBe(400)
  })

  it('404 для неизвестной точки', async () => {
    const r = await app.request('/api/admin/evotor/stores/nope/purge-catalog', {
      method: 'POST', headers: ownH, body: JSON.stringify({ confirm: 'удалить' }),
    })
    expect(r.status).toBe(404)
  })

  it('409, если по точке уже идёт операция', async () => {
    expect(tryLock(lockKey(STORE), 'wipe')).toBe(true)
    const r = await app.request(`/api/admin/evotor/stores/${STORE}/purge-catalog`, {
      method: 'POST', headers: ownH, body: JSON.stringify({ confirm: 'удалить' }),
    })
    expect(r.status).toBe(409)
    unlock(lockKey(STORE))
  })

  it('без токена Эвотор — 503 и локальные данные целы', async () => {
    const r = await app.request(`/api/admin/evotor/stores/${STORE}/purge-catalog`, {
      method: 'POST', headers: ownH, body: JSON.stringify({ confirm: 'удалить' }),
    })
    expect(r.status).toBe(503)
    expect(JSON.stringify(await r.json())).toMatch(/TOKEN/i)
    expect(paused()).toBe(0)
    const links = db.prepare('SELECT COUNT(*) AS n FROM product_store_links WHERE store_uuid=?').get(STORE) as { n: number }
    expect(links.n).toBe(1)
  })
})
