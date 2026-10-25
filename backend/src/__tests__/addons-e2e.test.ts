/**
 * Сквозная сверка добавок: админка (POST /api/admin/modifier-schemes) → каталог кассы
 * (GET /api/devices/catalog) → фикстура, которую читает APK.
 *
 * Канон схемы — modifier_scheme_options. Легаси modifier_scheme_items читается только как fallback
 * и конвертируется при сохранении.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'sc-addons-e2e-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const { runMigrations } = await import('../db/migrate')
const { app } = await import('../app')

const FIXTURE = fileURLToPath(new URL('./fixtures/addons-catalog-fixture.json', import.meta.url))
const STORE = 'store-fixture'

const ins = (sql: string, ...a: unknown[]) => Number(db.prepare(sql).run(...a).lastInsertRowid)

const admin = (method: string, path: string, body?: unknown) =>
  app.request(`/api/admin${path}`, {
    method,
    headers: { 'X-Admin-Token': 'test-admin', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const catalog = async (storeUuid = STORE) => {
  const r = await app.request(`/api/devices/catalog?storeUuid=${storeUuid}`)
  expect(r.status).toBe(200)
  return (await r.json()) as any
}

/** Стабильная часть ответа каталога: без generatedAt, чтобы фикстура не «старела». */
const snap = (j: any) => ({
  storeUuid: j.storeUuid,
  categories: j.categories,
  products: j.products,
  groups: j.groups,
})

let ids: {
  scheme: number
  categoryCoffee: number
  categoryFood: number
  categoryAddons: number
  group: number
  latte: number
  cap200: number
  cap400: number
  croissant: number
  syrupCaramel: number
  syrupVanilla: number
  milkOat: number
  cinnamon: number
}

beforeAll(async () => {
  runMigrations(db)
  const t = Date.now()

  const categoryCoffee = ins(`INSERT INTO categories(name,sort_order,available,created_at,updated_at) VALUES('Кофе',0,1,?,?)`, t, t)
  const categoryFood = ins(`INSERT INTO categories(name,sort_order,available,created_at,updated_at) VALUES('Еда',1,1,?,?)`, t, t)
  const categoryAddons = ins(`INSERT INTO categories(name,sort_order,available,created_at,updated_at) VALUES('Добавки',2,1,?,?)`, t, t)

  const addonProduct = (name: string, price: number) =>
    ins(
      `INSERT INTO products(name,price,icon,available,category_id,sort_order,created_at,updated_at,
         counts_as_cup,free_eligible,is_group,parent_product_id,catalog_source)
       VALUES(?,?,?,1,?,0,?,?,0,0,0,NULL,'SIXTH_CUP')`,
      name, price, 'Coffee', categoryAddons, t, t,
    )
  const syrupCaramel = addonProduct('Сироп карамель', 50)
  const syrupVanilla = addonProduct('Сироп ваниль', 40)
  const milkOat = addonProduct('Молоко овсяное', 60)
  const cinnamon = addonProduct('Корица', 20)
  for (const [id, uuid] of [
    [syrupCaramel, 'uuid-caramel'],
    [syrupVanilla, 'uuid-vanilla'],
    [milkOat, 'uuid-oat'],
    [cinnamon, 'uuid-cinnamon'],
  ] as const) {
    db.prepare('INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(id, STORE, uuid)
  }

  // Схема создаётся через тот же эндпоинт, что использует админка.
  const created = await admin('POST', '/modifier-schemes', {
    name: 'Схема фикстуры',
    options: [
      { kind: 'zero', groupKey: 'syrup', name: 'Без сиропа', isDefault: true, maxCount: 1 },
      { kind: 'product', groupKey: 'syrup', productId: syrupCaramel, maxCount: 1 },
      { kind: 'product', groupKey: 'syrup', productId: syrupVanilla, maxCount: 1 },
      { kind: 'zero', groupKey: 'milk', name: 'Обычное', isDefault: true, required: true, maxCount: 1 },
      { kind: 'product', groupKey: 'milk', productId: milkOat, maxCount: 1 },
      { kind: 'product', groupKey: 'extra', productId: cinnamon, maxCount: 2 },
    ],
  })
  expect(created.status).toBe(200)
  const scheme = Number(((await created.json()) as any).id)

  const group = ins(
    `INSERT INTO product_groups(name,modifier_scheme_id,counts_as_cup,free_eligible,sort_order,created_at,updated_at)
     VALUES('Капучино',?,1,1,0,?,?)`,
    scheme, t, t,
  )
  const drink = (name: string, price: number, opts: { groupId?: number; label?: string; sort?: number; schemeId?: number } = {}) =>
    ins(
      `INSERT INTO products(name,price,icon,available,category_id,sort_order,created_at,updated_at,
         counts_as_cup,free_eligible,group_id,variant_label,variant_sort,modifier_scheme_id,is_group,catalog_source)
       VALUES(?,?,?,1,?,?,?,?,1,1,?,?,?,?,0,'SIXTH_CUP')`,
      name, price, 'Coffee', categoryCoffee, opts.sort ?? 0, t, t, opts.groupId ?? null, opts.label ?? null,
      opts.sort ?? 0, opts.schemeId ?? null,
    )
  const cap200 = drink('Капучино 200 мл', 200, { groupId: group, label: '200 мл', sort: 0 })
  const cap400 = drink('Капучино 400 мл', 250, { groupId: group, label: '400 мл', sort: 1 })
  const latte = drink('Латте', 300, { schemeId: scheme, sort: 2 })
  const croissant = ins(
    `INSERT INTO products(name,price,icon,available,category_id,sort_order,created_at,updated_at,
       counts_as_cup,free_eligible,catalog_source)
     VALUES('Круассан',90,'Coffee',1,?,3,?,?,0,0,'SIXTH_CUP')`,
    categoryFood, t, t,
  )
  for (const [id, uuid] of [
    [cap200, 'uuid-cap200'],
    [cap400, 'uuid-cap400'],
    [latte, 'uuid-latte'],
    [croissant, 'uuid-croissant'],
  ] as const) {
    db.prepare('INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(id, STORE, uuid)
  }

  ids = { scheme, categoryCoffee, categoryFood, categoryAddons, group, latte, cap200, cap400, croissant, syrupCaramel, syrupVanilla, milkOat, cinnamon }
})

describe('3.2 схема назначается товару и группе размеров', () => {
  it('COALESCE(products.modifier_scheme_id, product_groups.modifier_scheme_id) даёт одну схему для всех вариантов', () => {
    const rows = db.prepare(`
      SELECT p.id, COALESCE(p.modifier_scheme_id, g.modifier_scheme_id) AS schemeId
      FROM products p LEFT JOIN product_groups g ON g.id = p.group_id
      WHERE p.id IN (?,?,?)
    `).all(ids.cap200, ids.cap400, ids.latte) as { id: number; schemeId: number }[]
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((r) => r.schemeId))).toEqual(new Set([ids.scheme]))
  })
})

describe('3.3 каталог отдаёт все опции и совпадает с фикстурой', () => {
  it('toppings: required/zeroOption/isDefault/available/maxCount/groupKey/uuid', async () => {
    const j = await catalog()
    const drinkTop = (id: number) => j.products.find((p: any) => p.id === id).toppings as any[]
    const tops = drinkTop(ids.cap200)
    expect(tops).toHaveLength(6)
    expect(tops.map((t) => t.groupKey)).toEqual(['syrup', 'syrup', 'syrup', 'milk', 'milk', 'extra'])
    expect(tops.filter((t) => t.zeroOption).map((t) => t.name)).toEqual(['Без сиропа', 'Обычное'])
    const milkZero = tops.find((t) => t.groupKey === 'milk' && t.zeroOption)
    expect(milkZero).toMatchObject({ required: true, isDefault: true, available: true, evotorUuid: null, maxCount: 1 })
    const milkPaid = tops.find((t) => t.groupKey === 'milk' && !t.zeroOption)
    expect(milkPaid).toMatchObject({ required: false, evotorUuid: 'uuid-oat', available: true, priceRub: 60 })
    const extra = tops.find((t) => t.groupKey === 'extra')
    expect(extra).toMatchObject({ maxCount: 2, evotorUuid: 'uuid-cinnamon', available: true })
    // та же схема доезжает до товара с собственной схемой и до второго варианта группы
    expect(drinkTop(ids.cap400)).toEqual(tops)
    expect(drinkTop(ids.latte)).toEqual(tops)
    // у товара-добавки своей схемы нет
    expect(j.products.find((p: any) => p.id === ids.syrupCaramel).toppings).toEqual([])
  })

  it('ответ каталога равен фикстуре APK', async () => {
    const got = snap(await catalog())
    if (process.env.WRITE_FIXTURE === '1') {
      writeFileSync(FIXTURE, `${JSON.stringify(got, null, 2)}\n`)
    }
    expect(got).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')))
  })
})

describe('3.6 повторное сохранение схемы из админки идемпотентно (R1/R2)', () => {
  it('save → catalog → save → catalog: результат идентичен, required не теряется', async () => {
    const before = snap(await catalog())
    const scheme = db.prepare('SELECT id, name FROM modifier_schemes WHERE id=?').get(ids.scheme) as any
    const options = db.prepare(`
      SELECT kind, product_id AS productId, modifier_id AS modifierId, name, group_key AS groupKey,
             is_default AS isDefault, required, max_count AS maxCount, price_override AS priceOverride,
             sort_order AS sortOrder
      FROM modifier_scheme_options WHERE scheme_id=? ORDER BY sort_order, id
    `).all(ids.scheme) as any[]
    const res = await admin('POST', '/modifier-schemes', {
      id: scheme.id,
      name: scheme.name,
      options: options.map((o) => ({
        kind: o.kind, productId: o.productId, modifierId: o.modifierId, name: o.name, groupKey: o.groupKey,
        isDefault: !!o.isDefault, required: !!o.required, maxCount: o.maxCount,
        priceOverride: o.priceOverride, sortOrder: o.sortOrder,
      })),
    })
    expect(res.status).toBe(200)
    expect(snap(await catalog())).toEqual(before)

    const saved = (await (await admin('GET', '/modifier-schemes')).json()) as any
    const opts = saved.schemes.find((s: any) => s.id === ids.scheme).options
    expect(opts.filter((o: any) => o.required).map((o: any) => o.groupKey)).toEqual(['milk'])
  })
})

describe('R1: старая админка пишет items — каталог обязан увидеть правку', () => {
  it('items конвертируются в options, легаси-таблица больше не расходится', async () => {
    const created = await admin('POST', '/modifier-schemes', {
      name: 'Схема legacy-правки',
      options: [{ kind: 'product', groupKey: 'syrup', productId: ids.syrupCaramel, maxCount: 1 }],
    })
    const scheme = Number(((await created.json()) as any).id)
    db.prepare('UPDATE products SET modifier_scheme_id=? WHERE id=?').run(scheme, ids.croissant)

    const before = (await catalog()).products.find((p: any) => p.id === ids.croissant).toppings
    // withZeroDefaults добавляет «Без сиропа» в группу syrup (в схеме её не было).
    expect(before.map((t: any) => t.name)).toEqual(['Без сиропа', 'Сироп карамель'])

    // payload старой админки (items) — раньше он писал только в modifier_scheme_items и терялся
    const saved = await admin('POST', '/modifier-schemes', {
      id: scheme,
      name: 'Схема legacy-правки',
      items: [{ productId: ids.syrupVanilla, groupKey: 'topping', maxCount: 1, required: true }],
    })
    expect(saved.status).toBe(200)

    const after = (await catalog()).products.find((p: any) => p.id === ids.croissant).toppings
    expect(after.map((t: any) => t.name)).toEqual(['Сироп ваниль'])
    expect(after[0]).toMatchObject({ groupKey: 'extra', required: true })
    const legacyRows = (db.prepare('SELECT COUNT(*) AS n FROM modifier_scheme_items WHERE scheme_id=?').get(scheme) as any).n
    expect(legacyRows).toBe(0)
  })
})

describe('R3: словарь групп — один источник', () => {
  it('GET /admin/addon-groups отдаёт канонические ключи', async () => {
    const r = await admin('GET', '/addon-groups')
    expect(r.status).toBe(200)
    const j = (await r.json()) as any
    expect(j.groups.map((g: any) => g.key)).toEqual(['milk', 'syrup', 'sugar', 'extra'])
    expect(j.groups.map((g: any) => g.label)).toEqual(['Молоко', 'Сироп', 'Сахар', 'Дополнительно'])
  })

  it('синонимы нормализуются, мусорный ключ — 400', async () => {
    const ok = await admin('POST', '/modifier-schemes', {
      name: 'Схема групп',
      options: [
        { kind: 'product', groupKey: 'молоко', productId: ids.milkOat, maxCount: 1 },
        { kind: 'product', groupKey: 'topping', productId: ids.cinnamon, maxCount: 2 },
        { kind: 'product', groupKey: 'сахар', productId: ids.syrupVanilla, maxCount: 1 },
      ],
    })
    expect(ok.status).toBe(200)
    const scheme = Number(((await ok.json()) as any).id)
    const keys = (db.prepare('SELECT group_key AS k FROM modifier_scheme_options WHERE scheme_id=? ORDER BY sort_order, id')
      .all(scheme) as { k: string }[]).map((r) => r.k)
    expect(keys).toEqual(['milk', 'extra', 'sugar'])

    const badRes = await admin('POST', '/modifier-schemes', {
      name: 'Схема мусора',
      options: [{ kind: 'product', groupKey: 'десерт-вне-словаря', productId: ids.cinnamon }],
    })
    expect(badRes.status).toBe(400)
  })
})

describe('R4: Studio берёт группу из нормализатора и лимит из группы', () => {
  it('group_key=sugar и topping дают канонические ключи, max_count не хардкодится', async () => {
    const t = Date.now()
    const sugarMod = ins(
      `INSERT INTO modifiers(name,price,group_key,available,sort_order,created_at,updated_at)
       VALUES('Сахар тростниковый',5,'sugar',1,0,?,?)`, t, t,
    )
    const toppingMod = ins(
      `INSERT INTO modifiers(name,price,group_key,available,sort_order,created_at,updated_at)
       VALUES('Топпинг карамель',30,'topping',1,0,?,?)`, t, t,
    )
    const created2 = await admin('POST', '/modifier-schemes', { name: 'Схема Studio', modifierIds: [sugarMod, toppingMod] })
    expect(created2.status).toBe(200)
    const scheme = Number(((await created2.json()) as any).id)
    const rows = db.prepare('SELECT modifier_id AS m, group_key AS g, max_count AS c FROM modifier_scheme_options WHERE scheme_id=? ORDER BY sort_order, id')
      .all(scheme) as { m: number; g: string; c: number }[]
    expect(rows.map((r) => [r.m, r.g, r.c])).toEqual([[sugarMod, 'sugar', 1], [toppingMod, 'extra', 2]])
  })
})
