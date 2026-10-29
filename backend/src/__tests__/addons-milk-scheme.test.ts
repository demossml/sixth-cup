import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-milk-'))
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
const T = Date.now()
const STORE = 'store-milk-' + T
const catalog = async (prefix: string) => {
  const j = (await (await app.request('/api/devices/catalog?storeUuid=' + STORE)).json()) as any
  return (j.products as any[]).filter((p) => String(p.name).startsWith(prefix))
}
const mkGroup = async (name: string, scheme: number | null) => {
  const r = await adm('POST', '/product-groups', {
    name, icon: 'Coffee', sortOrder: 0, modifierSchemeId: scheme, countsAsCup: true, freeEligible: true,
    variants: [{ label: '200 мл', price: 200 }, { label: '300 мл', price: 250 }, { label: '400 мл', price: 300 }],
  })
  expect(r.s).toBe(200)
  return r.j.id as number
}
const mkMod = async (name: string, groupKey: string) => {
  expect((await adm('POST', '/modifiers', { name: `${name}-${T}`, price: 40, groupKey })).s).toBe(200)
  const m = ((await adm('GET', '/modifiers')).j.modifiers as any[]).find((x) => x.name === `${name}-${T}`)
  db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(m.linkedProductId, STORE, 'u-' + m.id)
  return m.id as number
}
const mkScheme = async (name: string, options: unknown[]) => {
  const r = await adm('POST', '/modifier-schemes', { name, options })
  expect(r.s).toBe(200)
  return r.j.id as number
}
const keys = (p: any) => [...new Set((p.toppings as any[]).map((t) => t.groupKey))].sort()

describe('B1: удаление схемы чистит группы', () => {
  it('product_groups.modifier_scheme_id становится NULL, чужая группа не тронута', async () => {
    const milk = await mkMod('МолокоB1', 'milk')
    const s1 = await mkScheme('B1-a', [{ kind: 'modifier', modifierId: milk, groupKey: 'milk' }])
    const s2 = await mkScheme('B1-b', [{ kind: 'modifier', modifierId: milk, groupKey: 'milk' }])
    const g1 = await mkGroup('КапB1', s1)
    const g2 = await mkGroup('ЛатB1', s2)
    expect((await catalog('КапB1')).every((p) => p.toppings.length > 0)).toBe(true)

    expect((await adm('DELETE', '/modifier-schemes/' + s1)).s).toBe(200)

    const row = (id: number) => db.prepare('SELECT modifier_scheme_id AS s FROM product_groups WHERE id=?').get(id) as { s: number | null }
    expect(row(g1).s).toBeNull()
    expect(row(g2).s).toBe(s2)
    expect(db.prepare('SELECT 1 FROM modifier_schemes WHERE id=?').get(s1)).toBeUndefined()
    // честно пусто, без висячего id; соседняя группа продолжает получать добавки
    expect((await catalog('КапB1')).every((p) => p.toppings.length === 0)).toBe(true)
    expect((await catalog('ЛатB1')).every((p) => p.toppings.length > 0)).toBe(true)
  })

  it('повторное назначение схемы группе после удаления снова даёт toppings', async () => {
    const milk = await mkMod('МолокоB1r', 'milk')
    const s1 = await mkScheme('B1r-a', [{ kind: 'modifier', modifierId: milk, groupKey: 'milk' }])
    const g = await mkGroup('КапB1r', s1)
    await adm('DELETE', '/modifier-schemes/' + s1)
    const s2 = await mkScheme('B1r-b', [{ kind: 'modifier', modifierId: milk, groupKey: 'milk' }])
    const r = await adm('POST', '/product-groups', {
      id: g, name: 'КапB1r', icon: 'Coffee', sortOrder: 0, modifierSchemeId: s2, countsAsCup: true, freeEligible: true,
      variants: ((await adm('GET', '/product-groups')).j.groups as any[]).find((x) => x.id === g).variants
        .map((v: any) => ({ id: v.id, label: v.label, price: v.price })),
    })
    expect(r.s).toBe(200)
    expect((await catalog('КапB1r')).every((p) => keys(p).includes('milk'))).toBe(true)
  })
})

describe('B2: пустая схема размера не перекрывает полную схему группы', () => {
  it('размер с пустой схемой + группа с полной → toppings группы', async () => {
    const milk = await mkMod('МолокоB2', 'milk')
    const full = await mkScheme('B2-full', [
      { kind: 'zero', groupKey: 'milk', isDefault: true },
      { kind: 'modifier', modifierId: milk, groupKey: 'milk' },
    ])
    const empty = (await adm('POST', '/modifier-schemes', { name: 'B2-empty', modifierIds: [] })).j.id as number
    const g = await mkGroup('КапB2', full)
    db.prepare('UPDATE products SET modifier_scheme_id=? WHERE group_id=?').run(empty, g)
    const rows = await catalog('КапB2')
    expect(rows).toHaveLength(3)
    for (const p of rows) expect(keys(p)).toEqual(['milk'])
  })

  it('непустая схема размера по-прежнему главнее схемы группы', async () => {
    const milk = await mkMod('МолокоB2s', 'milk')
    const syr = await mkMod('СиропB2s', 'syrup')
    const grp = await mkScheme('B2s-grp', [{ kind: 'modifier', modifierId: milk, groupKey: 'milk' }])
    const own = await mkScheme('B2s-own', [{ kind: 'modifier', modifierId: syr, groupKey: 'syrup' }])
    const g = await mkGroup('КапB2s', grp)
    db.prepare('UPDATE products SET modifier_scheme_id=? WHERE group_id=?').run(own, g)
    for (const p of await catalog('КапB2s')) expect(keys(p)).toEqual(['syrup'])
  })

  it('обе схемы пустые или не заданы → [] как раньше', async () => {
    const e1 = (await adm('POST', '/modifier-schemes', { name: 'B2-e1', modifierIds: [] })).j.id as number
    const e2 = (await adm('POST', '/modifier-schemes', { name: 'B2-e2', modifierIds: [] })).j.id as number
    const g = await mkGroup('КапB2e', e1)
    db.prepare('UPDATE products SET modifier_scheme_id=? WHERE group_id=?').run(e2, g)
    for (const p of await catalog('КапB2e')) expect(p.toppings).toEqual([])
    await mkGroup('КапB2n', null)
    for (const p of await catalog('КапB2n')) expect(p.toppings).toEqual([])
  })

  it('схема размера с легаси-items (без options) считается непустой', async () => {
    const milk = await mkMod('МолокоB2l', 'milk')
    const grp = await mkScheme('B2l-grp', [{ kind: 'modifier', modifierId: milk, groupKey: 'milk' }])
    const g = await mkGroup('КапB2l', grp)
    const t = Date.now()
    const legacy = Number(db.prepare('INSERT INTO modifier_schemes(name,created_at,updated_at) VALUES(?,?,?)').run('B2l-legacy', t, t).lastInsertRowid)
    const syr = await mkMod('СиропB2l', 'syrup')
    db.prepare('INSERT INTO modifier_scheme_items(scheme_id,modifier_id,required,max_count) VALUES(?,?,0,1)').run(legacy, syr)
    db.prepare('UPDATE products SET modifier_scheme_id=? WHERE group_id=?').run(legacy, g)
    for (const p of await catalog('КапB2l')) expect(keys(p)).toContain('syrup')
  })
})

describe('B3: группа молока из схемы главнее группы справочника', () => {
  it('модификатор «other», в схеме «milk» → groupKey milk', async () => {
    const m = await mkMod('МолокоB3', 'other')
    const s = await mkScheme('B3-a', [{ kind: 'modifier', modifierId: m, groupKey: 'milk' }])
    await mkGroup('КапB3a', s)
    for (const p of await catalog('КапB3a')) {
      const t = (p.toppings as any[]).find((x) => !x.zeroOption && x.name.startsWith('МолокоB3'))
      expect(t.groupKey).toBe('milk')
    }
  })

  it('модификатор «milk», в схеме «extra» → milk (extra в схеме не перебивает)', async () => {
    const m = await mkMod('МолокоB3b', 'milk')
    const s = await mkScheme('B3-b', [{ kind: 'modifier', modifierId: m, groupKey: 'extra' }])
    await mkGroup('КапB3b', s)
    for (const p of await catalog('КапB3b')) {
      expect((p.toppings as any[]).find((x) => x.name.startsWith('МолокоB3b')).groupKey).toBe('milk')
    }
  })

  it('модификатор «milk», в схеме «syrup» → syrup (явный выбор схемы)', async () => {
    const m = await mkMod('МолокоB3c', 'milk')
    const s = await mkScheme('B3-c', [{ kind: 'modifier', modifierId: m, groupKey: 'syrup' }])
    await mkGroup('КапB3c', s)
    for (const p of await catalog('КапB3c')) {
      expect((p.toppings as any[]).find((x) => x.name.startsWith('МолокоB3c')).groupKey).toBe('syrup')
    }
  })

  it('«Обычное» добавляется, когда молоко попало в группу milk', async () => {
    const m = await mkMod('МолокоB3d', 'other')
    const s = await mkScheme('B3-d', [{ kind: 'modifier', modifierId: m, groupKey: 'milk' }])
    await mkGroup('КапB3d', s)
    for (const p of await catalog('КапB3d')) {
      expect((p.toppings as any[]).some((x) => x.zeroOption && x.groupKey === 'milk')).toBe(true)
    }
  })
})
