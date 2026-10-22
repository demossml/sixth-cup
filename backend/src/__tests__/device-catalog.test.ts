import { describe, expect, it, beforeAll } from 'vitest'
import { db } from '../db'
import { runMigrations } from '../db/migrate'

describe('device catalog data shape', () => {
  beforeAll(() => {
    runMigrations(db)
  })

  it('products table and links readable for catalog', () => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n
    expect(n).toBeGreaterThanOrEqual(0)
    // migration 013 availability table
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('product_store_availability')
  })
})

describe('GET /api/devices/catalog: toppings / modifier products / upsell', () => {
  it('scheme from group, topping evotorUuid, isModifier, upsell excludes modifiers', async () => {
    const { app } = await import('../app')
    const t = Date.now()
    const STORE = 'store-cat-test'
    const ins = (sql: string, ...a: unknown[]) => Number(db.prepare(sql).run(...a).lastInsertRowid)
    const scheme = ins('INSERT INTO modifier_schemes(name,created_at,updated_at) VALUES(?,?,?)', 'Кофе-тест', t, t)
    const mod = ins(`INSERT INTO modifiers(name,price,group_key,available,sort_order,created_at,updated_at) VALUES(?,?,?,1,0,?,?)`, 'Орех-тест', 40, 'syrup', t, t)
    db.prepare('INSERT INTO modifier_scheme_items(scheme_id,modifier_id,required,max_count) VALUES(?,?,0,2)').run(scheme, mod)
    const group = ins(`INSERT INTO product_groups(name,modifier_scheme_id,counts_as_cup,free_eligible,sort_order,created_at,updated_at) VALUES(?,?,1,1,0,?,?)`, 'Капучино-тест', scheme, t, t)
    const prodSql = `INSERT INTO products(name,price,icon,available,sort_order,created_at,updated_at,counts_as_cup,free_eligible,group_id,variant_label) VALUES(?,?,?,1,0,?,?,?,?,?,?)`
    const cap = ins(prodSql, 'Капучино-тест 200 мл', 200, 'Coffee', t, t, 1, 1, group, '200 мл') // no own scheme
    const nut = ins(prodSql, 'орех-ТЕСТ', 40, 'Coffee', t, t, 0, 0, null, null)
    const bun = ins(prodSql, 'Булочка-тест', 90, 'Coffee', t, t, 0, 0, null, null)
    db.prepare('INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(nut, STORE, 'uuid-nut')
    const r = await app.request(`/api/devices/catalog?storeUuid=${STORE}`)
    expect(r.status).toBe(200)
    const j = (await r.json()) as { products: any[] }
    const byId = (id: number) => j.products.find((p) => p.id === id)
    expect(byId(cap).countsAsCup).toBe(true)
    expect(byId(cap).toppings.length).toBe(1)
    expect(byId(cap).toppings[0]).toHaveProperty('evotorUuid', 'uuid-nut')
    expect(byId(cap).toppings[0].groupKey).toBe('syrup')
    expect(byId(nut).isModifier).toBe(true)
    expect(byId(nut).hideFromMenu).toBe(true)
    expect(byId(bun).isModifier).toBe(false)
    const upsellIds = byId(cap).upsell.map((u: any) => u.id)
    expect(upsellIds).toContain(bun)
    expect(upsellIds).not.toContain(nut)
  })
})


describe('GET /api/devices/catalog: multi-store uuid isolation', () => {
  it('returns only this store uuid when storeUuid set (no foreign fallback)', async () => {
    const { app } = await import('../app')
    const t = Date.now()
    const ins = (sql: string, ...a: unknown[]) => Number(db.prepare(sql).run(...a).lastInsertRowid)
    const prodSql = `INSERT INTO products(name,price,icon,available,sort_order,created_at,updated_at,counts_as_cup,free_eligible) VALUES(?,?,?,1,0,?,?,?,?)`
    const pid = ins(prodSql, 'Мульти-тест напиток', 100, 'Coffee', t, t, 1, 1)
    db.prepare('INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(pid, 'store-A', 'uuid-from-A')
    db.prepare('INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(pid, 'store-B', 'uuid-from-B')
    const rA = await app.request('/api/devices/catalog?storeUuid=store-A')
    const jA = (await rA.json()) as { products: { id: number; evotorUuid: string | null }[] }
    const pA = jA.products.find((x) => x.id === pid)
    expect(pA?.evotorUuid).toBe('uuid-from-A')
    const rB = await app.request('/api/devices/catalog?storeUuid=store-B')
    const jB = (await rB.json()) as { products: { id: number; evotorUuid: string | null }[] }
    const pB = jB.products.find((x) => x.id === pid)
    expect(pB?.evotorUuid).toBe('uuid-from-B')
    // store with no link → null, not the other store
    const rC = await app.request('/api/devices/catalog?storeUuid=store-C-missing')
    const jC = (await rC.json()) as { products: { id: number; evotorUuid: string | null }[] }
    const pC = jC.products.find((x) => x.id === pid)
    expect(pC?.evotorUuid == null || pC?.evotorUuid === null).toBe(true)
  })
})
