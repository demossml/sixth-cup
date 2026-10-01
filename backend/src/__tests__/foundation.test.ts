import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-test-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

// Dynamic import after env
const { app } = await import('../app')
const { seedIfEmpty } = await import('../db/seed')
const { db } = await import('../db')

seedIfEmpty()

const admin = { 'X-Admin-Token': 'test-admin', 'Content-Type': 'application/json' }

async function json(method: string, path: string, body?: unknown, headers: Record<string, string> = admin) {
  const res = await app.request(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

describe('organizations', () => {
  it('creates and lists', async () => {
    const c = await json('POST', '/api/admin/organizations', {
      name: 'Test Org',
      legalName: 'ООО Тест',
      inn: '7701234567',
      taxRegime: 'osn',
      vatRate: 20,
    })
    expect(c.status).toBe(200)
    expect(c.data.id).toBeGreaterThan(0)

    const list = await json('GET', '/api/admin/organizations')
    expect(list.data.organizations.length).toBeGreaterThanOrEqual(1)

    const one = await json('GET', `/api/admin/organizations/${c.data.id}`)
    expect(one.data.organization.vatRate).toBe(20)
    expect(one.data.organization.taxRegime).toBe('osn')
  })

  it('rejects missing name', async () => {
    const c = await json('POST', '/api/admin/organizations', {
      name: '',
      legalName: 'X',
      inn: '7701234567',
    })
    expect(c.status).toBeGreaterThanOrEqual(400)
  })

  it('patches active', async () => {
    const c = await json('POST', '/api/admin/organizations', {
      name: 'Patch Me', legalName: 'ООО Patch', inn: '7709999888',
    })
    const p = await json('PATCH', `/api/admin/organizations/${c.data.id}`, { active: false })
    expect(p.status).toBe(200)
    const one = await json('GET', `/api/admin/organizations/${c.data.id}`)
    expect(one.data.organization.active).toBe(0)
  })
})

describe('stores', () => {
  it('creates with organization', async () => {
    const org = await json('POST', '/api/admin/organizations', {
      name: 'Store Org', legalName: 'ООО Store', inn: '7701111222',
    })
    const s = await json('POST', '/api/admin/stores', {
      name: 'New Store', address: 'Street 1', organizationId: org.data.id,
    })
    expect(s.status).toBe(200)
    const get = await json('GET', `/api/admin/stores/${s.data.id}`)
    expect(get.data.store.organizationId).toBe(org.data.id)
  })

  it('fails without org', async () => {
    const s = await json('POST', '/api/admin/stores', {
      name: 'X', address: 'Y', organizationId: 999999,
    })
    expect(s.status).toBe(404)
  })
})

describe('categories and products', () => {
  it('category CRUD and product with category', async () => {
    const cat = await json('POST', '/api/admin/categories', { name: 'Test Cat', sortOrder: 5 })
    expect(cat.status).toBe(200)

    const prod = await json('POST', '/api/admin/products', {
      name: 'Test Drink', price: 100, categoryId: cat.data.id, description: 'desc', icon: 'Coffee',
    })
    expect(prod.status).toBe(200)

    const list = await json('GET', '/api/admin/products')
    const found = list.data.products.find((p: { name: string }) => p.name === 'Test Drink')
    expect(found.categoryId).toBe(cat.data.id)
    expect(found.description).toBe('desc')
  })
})

describe('directory compatibility', () => {
  it('keeps legacy fields and adds new', async () => {
    const res = await app.request('/api/directory')
    const d = await res.json()
    expect(res.status).toBe(200)
    expect(d).toHaveProperty('serverPub')
    expect(d).toHaveProperty('cupsForFree')
    expect(d).toHaveProperty('devices')
    expect(d).toHaveProperty('stores')
    expect(d).toHaveProperty('products')
    expect(d).toHaveProperty('promos')
    expect(d).toHaveProperty('organizations')
    expect(d).toHaveProperty('categories')
    expect(Array.isArray(d.products)).toBe(true)
    if (d.products[0]) {
      expect(d.products[0]).toHaveProperty('id')
      expect(d.products[0]).toHaveProperty('name')
      expect(d.products[0]).toHaveProperty('price')
      expect(d.products[0]).toHaveProperty('icon')
    }
  })
})

describe('migration preserves base tables', () => {
  it('schema_migrations has entries', () => {
    const rows = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as { id: string }[]
    expect(rows.map((r) => r.id)).toEqual(
      expect.arrayContaining(['001_organizations', '002_categories_products'])
    )
  })

  it('stores and devices tables exist', () => {
    const s = db.prepare('SELECT COUNT(*) AS n FROM stores').get() as { n: number }
    const d = db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number }
    expect(s.n).toBeGreaterThanOrEqual(0)
    expect(d.n).toBeGreaterThanOrEqual(0)
  })
})

afterAll(() => {
  try { db.close() } catch { /* */ }
  rmSync(dir, { recursive: true, force: true })
})

describe('product update and availability', () => {
  it('updates product and toggles available', async () => {
    const cat = await json('POST', '/api/admin/categories', { name: 'EditCat' })
    await json('POST', '/api/admin/products', {
      name: 'ToEdit', price: 99, categoryId: cat.data.id, icon: 'Coffee',
    })
    const list1 = await json('GET', '/api/admin/products')
    const p = list1.data.products.find((x: { name: string }) => x.name === 'ToEdit')
    expect(p).toBeTruthy()

    await json('POST', '/api/admin/products', {
      id: p.id, name: 'Edited', price: 120, categoryId: cat.data.id,
      icon: 'Coffee', available: false, description: 'x',
    })
    const list2 = await json('GET', '/api/admin/products')
    const p2 = list2.data.products.find((x: { id: number }) => x.id === p.id)
    expect(p2.name).toBe('Edited')
    expect(p2.price).toBe(120)
    expect(p2.available).toBe(0)

    const dir = await (await app.request('/api/directory')).json()
    expect(dir.products.find((x: { id: number }) => x.id === p.id)).toBeUndefined()
  })
})
