import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-variants-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'own'
process.env.EVOTOR_PROXY_TOKEN = 'proxy'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')

const admin = (method: string, p: string, body?: unknown) =>
  app.request('/api/admin' + p, {
    method,
    headers: { 'X-Admin-Token': 'own', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const json = async (r: Response) => (await r.json()) as any

const baseGroup = {
  name: 'Капучино',
  icon: 'Coffee',
  countsAsCup: true,
  freeEligible: true,
  variants: [
    { label: '200 мл', price: 200, sizeValue: 200, sizeUnit: 'ml' },
    { label: '300 мл', price: 300, sizeValue: 300, sizeUnit: 'ml' },
  ],
}

describe('product variants (sizes) — одна карточка, N SKU на кассе', () => {
  it('миграция 022 добавила групповые колонки', () => {
    const cols = (db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['group_id', 'variant_label', 'variant_sort']))
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map((t) => t.name)
    expect(tables).toContain('product_groups')
  })

  it('создаёт два SKU с разными ценами и метками', async () => {
    const r = await admin('POST', '/product-groups', baseGroup)
    expect(r.status).toBe(200)
    const body = await json(r)
    expect(body.ok).toBe(true)
    expect(body.variants).toHaveLength(2)

    const rows = db.prepare(
      `SELECT id, name, price, variant_label AS label, variant_sort AS sort, group_id AS gid, available, size_value AS sv, size_unit AS su, counts_as_cup AS cup
       FROM products WHERE group_id=? ORDER BY variant_sort`,
    ).all(body.id) as any[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'Капучино 200 мл', price: 200, label: '200 мл', sort: 0, available: 1, sv: 200, su: 'ml', cup: 1 })
    expect(rows[1]).toMatchObject({ name: 'Капучино 300 мл', price: 300, label: '300 мл', sort: 1, available: 1 })
    // у каждого размера свой product id → своя позиция номенклатуры в Эвотор
    expect(rows[0].id).not.toBe(rows[1].id)
  })

  it('отдаёт группу с вариантами в админке', async () => {
    const created = await json(await admin('POST', '/product-groups', { ...baseGroup, name: 'Латте' }))
    const list = await json(await admin('GET', '/product-groups'))
    const g = (list.groups as any[]).find((x) => x.id === created.id)
    expect(g).toBeTruthy()
    expect(g.name).toBe('Латте')
    expect(g.variants.map((v: any) => v.label)).toEqual(['200 мл', '300 мл'])
  })

  it('добавление и снятие размера: новые создаются, лишние уходят в available=0', async () => {
    const created = await json(await admin('POST', '/product-groups', { ...baseGroup, name: 'Флэт' }))
    const before = db.prepare('SELECT id, variant_label AS label FROM products WHERE group_id=? ORDER BY variant_sort').all(created.id) as any[]

    const upd = await json(await admin('POST', '/product-groups', {
      id: created.id,
      name: 'Флэт',
      icon: 'Coffee',
      variants: [
        { id: before[0].id, label: '200 мл', price: 210, sizeValue: 200, sizeUnit: 'ml' },
        { label: '400 мл', price: 350, sizeValue: 400, sizeUnit: 'ml' },
      ],
    }))
    expect(upd.disabledVariantIds).toEqual([before[1].id])

    const after = db.prepare('SELECT id, price, available, variant_label AS label FROM products WHERE group_id=? ORDER BY variant_sort').all(created.id) as any[]
    const active = after.filter((r) => r.available === 1)
    expect(active).toHaveLength(2)
    expect(active[0]).toMatchObject({ id: before[0].id, price: 210, label: '200 мл' })
    expect(active[1]).toMatchObject({ price: 350, label: '400 мл' })
    // Снятый размер остаётся в базе (история чеков), но не торгуется.
    const gone = after.find((r) => r.id === before[1].id)
    expect(gone.available).toBe(0)
  })

  it('отклоняет дубли размеров и пустой список', async () => {
    const dup = await admin('POST', '/product-groups', {
      ...baseGroup,
      name: 'Дубли',
      variants: [
        { label: '200 мл', price: 200, sizeValue: 200, sizeUnit: 'ml' },
        { label: '200 мл', price: 250, sizeValue: 200, sizeUnit: 'ml' },
      ],
    })
    expect(dup.status).toBe(400)
    const empty = await admin('POST', '/product-groups', { name: 'Пусто', variants: [] })
    expect(empty.status).toBe(400)
  })

  it('каталог кассы отдаёт groups[] с UUID каждого размера', async () => {
    const created = await json(await admin('POST', '/product-groups', { ...baseGroup, name: 'Раф' }))
    const r = await app.request('/api/devices/catalog', { headers: { Authorization: 'Bearer proxy' } })
    expect(r.status).toBe(200)
    const body = await json(r)
    const group = (body.groups as any[]).find((g) => g.id === created.id)
    expect(group).toBeTruthy()
    expect(group.name).toBe('Раф')
    expect(group.variants).toHaveLength(2)
    expect(group.variants.map((v: any) => v.label)).toEqual(['200 мл', '300 мл'])
    expect(group.variants.map((v: any) => v.price)).toEqual([200, 300])
    // Плоский список остаётся для старых версий APK.
    const flat = (body.products as any[]).filter((p) => p.groupId === created.id)
    expect(flat).toHaveLength(2)
    expect(flat[0].variantLabel).toBe('200 мл')
  })

  it('публичный directory отдаёт productGroups, одиночные товары не ломаются', async () => {
    const created = await json(await admin('POST', '/product-groups', { ...baseGroup, name: 'Мокко' }))
    const r = await app.request('/api/directory')
    expect(r.status).toBe(200)
    const body = await json(r)
    const group = (body.productGroups as any[]).find((g) => g.id === created.id)
    expect(group).toBeTruthy()
    expect(group.variants).toHaveLength(2)
    expect(Array.isArray(body.products)).toBe(true)
  })

  it('разъединение: SKU остаются, группа удаляется', async () => {
    const created = await json(await admin('POST', '/product-groups', { ...baseGroup, name: 'Какао' }))
    const del = await admin('DELETE', `/product-groups/${created.id}`)
    expect(del.status).toBe(200)
    expect((await json(del)).detached).toBe(2)
    const left = db.prepare('SELECT COUNT(*) AS n FROM products WHERE group_id=?').get(created.id) as { n: number }
    expect(left.n).toBe(0)
    const still = db.prepare('SELECT COUNT(*) AS n FROM products WHERE name LIKE ?').get('Какао%') as { n: number }
    expect(still.n).toBe(2)
  })
})
