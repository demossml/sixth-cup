/**
 * Конструктор «Меню и Ценники»: документ в SQLite и цены из каталога.
 *
 * Главное: цена строки, привязанной к товару, всегда из базы — клиент её не перебьёт, а изменение
 * цены в каталоге ставит документы в печать и пишется в журнал.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-poster-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { linkToMilk, linkToProduct } = await import('@sixth-cup/menu-core/catalog')
type Workspace = import('@sixth-cup/menu-core/model').Workspace
type Catalog = import('@sixth-cup/menu-core/catalog').Catalog

const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
const now = Date.now()
const ids = { group: 9001, s: 9011, m: 9012, l: 9013, oatProduct: 9020, milkScheme: 0, oat: 0, syrup: 9030 }

beforeAll(() => {
  const coffee = Number(db.prepare('INSERT INTO categories(name, sort_order, created_at, updated_at) VALUES(?,?,?,?)').run('Кофе тест', 0, now, now).lastInsertRowid)
  const addons = Number(db.prepare('INSERT INTO categories(name, sort_order, created_at, updated_at) VALUES(?,?,?,?)').run('Добавки', 9, now, now).lastInsertRowid)
  db.prepare('INSERT INTO product_groups(id, name, category_id, sort_order, created_at, updated_at) VALUES(?,?,?,?,?,?)').run(ids.group, 'Капучино', coffee, 0, now, now)
  const product = db.prepare('INSERT INTO products(id, name, price, icon, available, category_id, group_id, variant_label, variant_sort) VALUES(?,?,?,?,1,?,?,?,?)')
  product.run(ids.s, 'Капучино 250', 200, 'Coffee', coffee, ids.group, '250 мл', 0)
  product.run(ids.m, 'Капучино 350', 230, 'Coffee', coffee, ids.group, '350 мл', 1)
  product.run(ids.l, 'Капучино 400', 260, 'Coffee', coffee, ids.group, '400 мл', 2)
  db.prepare('INSERT INTO products(id, name, price, icon, available, category_id) VALUES(?,?,?,?,1,?)').run(ids.oatProduct, 'Овсяное молоко', 60, 'Milk', addons)
  db.prepare('INSERT INTO products(id, name, price, icon, available, category_id) VALUES(?,?,?,?,1,?)').run(ids.syrup, 'Сироп ваниль', 40, 'Coffee', addons)
  ids.milkScheme = Number(db.prepare('INSERT INTO milk_schemes(name, created_at, updated_at) VALUES(?,?,?)').run('Молоко', now, now).lastInsertRowid)
  db.prepare('INSERT INTO milk_scheme_variants(scheme_id, product_id, label, is_free, sort_order) VALUES(?,?,?,0,1)').run(ids.milkScheme, null, 'Обычное')
  ids.oat = Number(db.prepare('INSERT INTO milk_scheme_variants(scheme_id, product_id, label, is_free, sort_order) VALUES(?,?,?,0,2)').run(ids.milkScheme, ids.oatProduct, 'Овсяное').lastInsertRowid)
  db.prepare('UPDATE products SET milk_scheme_id=? WHERE group_id=?').run(ids.milkScheme, ids.group)
})

beforeEach(() => {
  db.prepare('DELETE FROM poster_workspace').run()
  db.prepare('UPDATE products SET price=? WHERE id=?').run(230, ids.m)
})

const getWs = async () => ((await (await app.request('/api/admin/poster/workspace', { headers: H })).json()) as { ws: Workspace }).ws
const getCatalog = async () => (await (await app.request('/api/admin/poster/catalog', { headers: H })).json()) as Catalog
const putWs = (ws: Workspace, baseRev = ws.rev) =>
  app.request('/api/admin/poster/workspace', { method: 'PUT', headers: H, body: JSON.stringify({ ws, baseRev }) })

/** Привязать «Капучино» и «Овсяное» из стартового меню к каталогу и сохранить. */
async function linkedWs() {
  const ws = await getWs()
  const cat = await getCatalog()
  const g = ws.groups.find((x) => x.id === 'g-coffee')!
  const item = g.items.find((i) => i.name === 'Капучино')!
  const product = cat.products.find((p) => p.id === `g:${ids.group}`)!
  linkToProduct(g, item, product)
  linkToMilk(item.variations.find((v) => v.name === 'Овсяное')!, product.milk.find((m) => m.id === ids.oat)!)
  const res = await putWs(ws)
  expect(res.status).toBe(200)
  return ((await res.json()) as { ws: Workspace }).ws
}

const cappuccino = (ws: Workspace) => ws.groups.find((x) => x.id === 'g-coffee')!.items.find((i) => i.name === 'Капучино')!

describe('poster: catalog', () => {
  it('builds a group with sizes, milk surcharges and add-ons from the database', async () => {
    const cat = await getCatalog()
    const cap = cat.products.find((p) => p.id === `g:${ids.group}`)!
    expect(cap).toMatchObject({ name: 'Капучино', addon: false, available: true })
    expect(cap.sizes).toEqual([
      { key: `p:${ids.s}`, label: '250 мл', price: 200 },
      { key: `p:${ids.m}`, label: '350 мл', price: 230 },
      { key: `p:${ids.l}`, label: '400 мл', price: 260 },
    ])
    expect(cap.milk.find((m) => m.id === ids.oat)).toEqual({ id: ids.oat, label: 'Овсяное', surcharge: 60 })
    expect(cat.products.find((p) => p.id === `p:${ids.syrup}`)).toMatchObject({ addon: true, sizes: [{ price: 40 }] })
    // размеры группы не дублируются отдельными товарами
    expect(cat.products.some((p) => p.id === `p:${ids.m}`)).toBe(false)
  })

  it('requires the admin token', async () => {
    expect((await app.request('/api/admin/poster/catalog')).status).toBe(403)
  })
})

describe('poster: workspace', () => {
  it('seeds on first read and rejects a save from a stale revision', async () => {
    const ws = await getWs()
    expect(ws.groups.length).toBeGreaterThan(0)
    expect((await putWs(ws)).status).toBe(200)
    const stale = await putWs(ws, ws.rev)
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as { ws: Workspace }).ws.rev).toBe(ws.rev + 1)
  })

  it('takes linked prices from the catalog; milk = size + surcharge', async () => {
    const ws = await linkedWs()
    const cap = cappuccino(ws)
    expect(cap.prices).toEqual([200, 230, 260])
    expect(cap.variations.find((v) => v.name === 'Овсяное')!.prices).toEqual([260, 290, 320])
  })

  it('does not let the client overwrite a linked price', async () => {
    const ws = await linkedWs()
    cappuccino(ws).prices[1] = 999
    const saved = ((await (await putWs(ws)).json()) as { ws: Workspace }).ws
    expect(cappuccino(saved).prices[1]).toBe(230)
  })

  it('applies a catalog price change, queues it for printing and logs it', async () => {
    await linkedWs()
    db.prepare('UPDATE products SET price=? WHERE id=?').run(240, ids.m)
    const ws = await getWs()
    const cap = cappuccino(ws)
    expect(cap.prices).toEqual([200, 240, 260])
    expect(cap.priceNotice?.at).toBeTruthy()
    expect(cap.variations.find((v) => v.name === 'Овсяное')!.prices[1]).toBe(300)
    expect(ws.changeLog.map((e) => e.text)).toContain('Цена из базы: Капучино 0.35: 230 → 240')
  })

  it('marks documents sent without an email', async () => {
    const ws = await getWs()
    const doc = ws.documents[0]!
    const res = await app.request('/api/admin/poster/mark', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ docs: [{ id: doc.id, hash: 'h1', file: 'menu.pdf' }], note: 'флешка' }),
    })
    expect(res.status).toBe(200)
    const after = ((await res.json()) as { ws: Workspace }).ws
    expect(after.documents.find((d) => d.id === doc.id)!.lastSent?.hash).toBe('h1')
    expect(after.sends.at(-1)).toMatchObject({ to: 'флешка', files: ['menu.pdf'] })
  })
})
