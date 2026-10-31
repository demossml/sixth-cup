/**
 * Молоко больше не живёт в схемах добавок.
 *
 * Здесь проверяем две вещи:
 *  1. механику схем добавок (удаление схемы, приоритет схемы SKU над группой) — на сиропах;
 *  2. идемпотентную миграцию легаси-строк `group_key='milk'` в отдельные схемы молока.
 */
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
const { migrateMilkFromAddonSchemes, inspectLegacyMilkOptions } = await import('../modules/catalog/milkFromAddons')

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
    const syrup = await mkMod('СиропB1', 'syrup')
    const s1 = await mkScheme('B1-a', [{ kind: 'modifier', modifierId: syrup, groupKey: 'syrup' }])
    const s2 = await mkScheme('B1-b', [{ kind: 'modifier', modifierId: syrup, groupKey: 'syrup' }])
    const g1 = await mkGroup('КапB1', s1)
    const g2 = await mkGroup('ЛатB1', s2)
    expect((await catalog('КапB1')).every((p) => p.toppings.length > 0)).toBe(true)

    expect((await adm('DELETE', '/modifier-schemes/' + s1)).s).toBe(200)

    const row = (id: number) => db.prepare('SELECT modifier_scheme_id AS s FROM product_groups WHERE id=?').get(id) as { s: number | null }
    expect(row(g1).s).toBeNull()
    expect(row(g2).s).toBe(s2)
    expect(db.prepare('SELECT 1 FROM modifier_schemes WHERE id=?').get(s1)).toBeUndefined()
    expect((await catalog('КапB1')).every((p) => p.toppings.length === 0)).toBe(true)
    expect((await catalog('ЛатB1')).every((p) => p.toppings.length > 0)).toBe(true)
  })

  it('повторное назначение схемы группе после удаления снова даёт toppings', async () => {
    const syrup = await mkMod('СиропB1r', 'syrup')
    const s1 = await mkScheme('B1r-a', [{ kind: 'modifier', modifierId: syrup, groupKey: 'syrup' }])
    const g = await mkGroup('КапB1r', s1)
    await adm('DELETE', '/modifier-schemes/' + s1)
    const s2 = await mkScheme('B1r-b', [{ kind: 'modifier', modifierId: syrup, groupKey: 'syrup' }])
    const r = await adm('POST', '/product-groups', {
      id: g, name: 'КапB1r', icon: 'Coffee', sortOrder: 0, modifierSchemeId: s2, countsAsCup: true, freeEligible: true,
      variants: ((await adm('GET', '/product-groups')).j.groups as any[]).find((x) => x.id === g).variants
        .map((v: any) => ({ id: v.id, label: v.label, price: v.price })),
    })
    expect(r.s).toBe(200)
    expect((await catalog('КапB1r')).every((p) => keys(p).includes('syrup'))).toBe(true)
  })
})

describe('B2: пустая схема размера не перекрывает полную схему группы', () => {
  it('размер с пустой схемой + группа с полной → toppings группы', async () => {
    const syrup = await mkMod('СиропB2', 'syrup')
    const full = await mkScheme('B2-full', [
      { kind: 'zero', groupKey: 'syrup', isDefault: true },
      { kind: 'modifier', modifierId: syrup, groupKey: 'syrup' },
    ])
    const empty = (await adm('POST', '/modifier-schemes', { name: 'B2-empty', modifierIds: [] })).j.id as number
    const g = await mkGroup('КапB2', full)
    db.prepare('UPDATE products SET modifier_scheme_id=? WHERE group_id=?').run(empty, g)
    const rows = await catalog('КапB2')
    expect(rows).toHaveLength(3)
    for (const p of rows) expect(keys(p)).toEqual(['syrup'])
  })

  it('непустая схема размера по-прежнему главнее схемы группы', async () => {
    const syrup = await mkMod('СиропB2s', 'syrup')
    const sugar = await mkMod('СахарB2s', 'other')
    const grp = await mkScheme('B2s-grp', [{ kind: 'modifier', modifierId: syrup, groupKey: 'syrup' }])
    const own = await mkScheme('B2s-own', [{ kind: 'modifier', modifierId: sugar, groupKey: 'sugar' }])
    const g = await mkGroup('КапB2s', grp)
    db.prepare('UPDATE products SET modifier_scheme_id=? WHERE group_id=?').run(own, g)
    for (const p of await catalog('КапB2s')) expect(keys(p)).toEqual(['sugar'])
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
    const syrup = await mkMod('СиропB2l', 'syrup')
    const grp = await mkScheme('B2l-grp', [{ kind: 'modifier', modifierId: syrup, groupKey: 'syrup' }])
    const g = await mkGroup('КапB2l', grp)
    const t = Date.now()
    const legacy = Number(db.prepare('INSERT INTO modifier_schemes(name,created_at,updated_at) VALUES(?,?,?)').run('B2l-legacy', t, t).lastInsertRowid)
    const sugar = await mkMod('СахарB2l', 'other')
    db.prepare("INSERT INTO modifier_scheme_items(scheme_id,modifier_id,group_key,required,max_count) VALUES(?,?,'sugar',0,1)").run(legacy, sugar)
    db.prepare('UPDATE products SET modifier_scheme_id=? WHERE group_id=?').run(legacy, g)
    for (const p of await catalog('КапB2l')) expect(keys(p)).toContain('sugar')
  })
})

describe('B3: легаси-молоко из схем добавок уезжает в схемы молока', () => {
  /** Кладём строки «молоко» напрямую в options — так выглядят базы до разделения схем. */
  const seedLegacyMilk = (schemeId: number, rows: { kind: string; productId?: number | null; name?: string; isDefault?: number }[]) => {
    const ins = db.prepare(
      `INSERT INTO modifier_scheme_options(scheme_id,kind,product_id,modifier_id,name,group_key,is_default,required,max_count,sort_order)
       VALUES(?,?,?,?,?,'milk',?,0,1,0)`,
    )
    for (const r of rows) ins.run(schemeId, r.kind, r.productId ?? null, null, r.name ?? null, r.isDefault ?? 0)
  }

  it('переносит бесплатное и платное молоко, назначает схему товару и чистит добавки', async () => {
    const oat = await mkMod('ОвсяноеB3', 'extra')
    const oatProductId = ((await adm('GET', '/modifiers')).j.modifiers as any[]).find((x) => x.id === oat).linkedProductId as number
    const syrup = await mkMod('СиропB3', 'syrup')
    const scheme = await mkScheme('B3-legacy', [{ kind: 'modifier', modifierId: syrup, groupKey: 'syrup' }])
    seedLegacyMilk(scheme, [
      { kind: 'zero', name: 'Обычное молоко', isDefault: 1 },
      { kind: 'product', productId: oatProductId },
    ])
    const drink = (await adm('POST', '/products', { name: `КапB3-${T}`, price: 250, modifierSchemeId: scheme })).j.id as number
    expect(inspectLegacyMilkOptions(db)).not.toHaveLength(0)

    const report = migrateMilkFromAddonSchemes(db)
    expect(report.migratedOptions).toBe(2)
    expect(report.ambiguous).toEqual([])
    expect(inspectLegacyMilkOptions(db)).toHaveLength(0)

    const milkSchemeId = (db.prepare('SELECT milk_scheme_id AS id FROM products WHERE id=?').get(drink) as { id: number }).id
    expect(milkSchemeId).toBeGreaterThan(0)
    const variants = db.prepare('SELECT label,is_free,send_to_receipt,is_default FROM milk_scheme_variants WHERE scheme_id=? ORDER BY sort_order').all(milkSchemeId) as any[]
    expect(variants).toHaveLength(2)
    expect(variants[0]).toMatchObject({ label: 'Обычное молоко', is_free: 1, send_to_receipt: 0, is_default: 1 })
    expect(variants[1]).toMatchObject({ is_free: 0, send_to_receipt: 1 })

    const p = (await catalog('КапB3'))[0]
    expect(keys(p)).toEqual(['syrup'])
    expect(p.milk).toHaveLength(2)
  })

  it('повторный запуск ничего не меняет (идемпотентность)', async () => {
    const again = migrateMilkFromAddonSchemes(db)
    expect(again.migratedOptions).toBe(0)
    expect(again.schemesCreated).toBe(0)
    expect(again.productsAssigned).toBe(0)
  })

  it('платное молоко без товара не переносится: строка остаётся, попадает в отчёт', async () => {
    const scheme = await mkScheme('B3-amb', [{ kind: 'zero', groupKey: 'syrup', name: 'Без сиропа', isDefault: true }])
    db.prepare(
      `INSERT INTO modifier_scheme_options(scheme_id,kind,product_id,modifier_id,name,group_key,is_default,required,max_count,sort_order)
       VALUES(?,'product',NULL,NULL,NULL,'milk',0,0,1,0)`,
    ).run(scheme)
    const report = migrateMilkFromAddonSchemes(db)
    expect(report.ambiguous).toHaveLength(1)
    expect(report.ambiguous[0]).toMatchObject({ schemeId: scheme })
    expect(report.ambiguous[0].reason).toMatch(/без товара/i)
    expect(inspectLegacyMilkOptions(db)).toHaveLength(1)

    // Убираем за собой, чтобы не влиять на другие тесты файла
    db.prepare("DELETE FROM modifier_scheme_options WHERE group_key='milk'").run()
  })

  it('новая схема добавок с молоком отклоняется backend-ом', async () => {
    const r = await adm('POST', '/modifier-schemes', {
      name: 'B3-reject',
      options: [{ kind: 'zero', groupKey: 'milk', name: 'Обычное' }],
    })
    expect(r.s).toBe(400)
    expect(JSON.stringify(r.j)).toMatch(/молок/i)
  })
})
