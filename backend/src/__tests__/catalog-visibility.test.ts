/**
 * Классификация добавок и связка «backend ↔ терминал» без опоры на название.
 * Изолированная temp-БД (DB_PATH), рабочая база не затрагивается.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-visibility-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const { runMigrations } = await import('../db/migrate')
const { app } = await import('../app')
const { productArticleNumber, parseProductArticleNumber } = await import('../modules/catalog/productIdentity')

const ins = (sql: string, ...a: unknown[]) => Number(db.prepare(sql).run(...a).lastInsertRowid)
const STORE = 'store-visibility'

const catalog = async (storeUuid = STORE) => {
  const r = await app.request(`/api/devices/catalog?storeUuid=${storeUuid}`)
  expect(r.status).toBe(200)
  return (await r.json()) as any
}
const byId = (j: any, id: number) => j.products.find((p: any) => p.id === id)

let ids: {
  catAddons: number
  catAddons2: number
  catDrinks: number
  syrupInAddons: number
  syrupInSecondCategory: number
  retailSameName: number
  ordinary: number
  group: number
  variantA: number
  variantB: number
  sameNameGroup1: number
  sameNameGroup2: number
}

beforeAll(() => {
  runMigrations(db)
  const t = Date.now()
  const cat = (name: string, sort: number) =>
    ins(`INSERT INTO categories(name,sort_order,available,created_at,updated_at) VALUES(?,?,1,?,?)`, name, sort, t, t)
  const catDrinks = cat('Напитки', 0)
  const catAddons = cat('Добавки', 1)
  const catAddons2 = cat('Добавки к напиткам', 2)

  const product = (name: string, categoryId: number | null) =>
    ins(
      `INSERT INTO products(name,price,icon,available,category_id,sort_order,created_at,updated_at,
         counts_as_cup,free_eligible,is_group,catalog_source)
       VALUES(?,100,'Coffee',1,?,0,?,?,0,0,0,'SIXTH_CUP')`,
      name, categoryId, t, t,
    )
  const syrupInAddons = product('Карамель', catAddons)
  const syrupInSecondCategory = product('Лаванда', catAddons2)
  const retailSameName = product('Карамель', catDrinks) // обычный товар с тем же именем
  const ordinary = product('Круассан', catDrinks)

  // Схема со ссылкой на SKU добавки (явная связь, не по имени).
  const scheme = ins(`INSERT INTO modifier_schemes(name,created_at,updated_at) VALUES('Схема',?,?)`, t, t)
  const t2 = Date.now()
  db.prepare(`INSERT INTO modifier_scheme_options(scheme_id,kind,product_id,name,group_key,sort_order)
              VALUES(?, 'product', ?, NULL, 'syrup', 0)`).run(scheme, syrupInAddons)

  const group = ins(
    `INSERT INTO product_groups(name,modifier_scheme_id,sort_order,created_at,updated_at)
     VALUES('Капучино',?,0,?,?)`, scheme, t, t,
  )
  const variant = (label: string, price: number, sort: number) =>
    ins(
      `INSERT INTO products(name,price,icon,available,category_id,sort_order,created_at,updated_at,
         counts_as_cup,free_eligible,group_id,variant_label,variant_sort,catalog_source)
       VALUES(?,?,'Coffee',1,?,0,?,?,1,1,?,?,?,'SIXTH_CUP')`,
      `Капучино ${label}`, price, catDrinks, t, t, group, label, sort,
    )
  const variantA = variant('S', 200, 0)
  const variantB = variant('L', 250, 1)

  // Два НЕЗАВИСИМЫХ напитка с одинаковым названием в разных группах.
  const makeGroup = (name: string) =>
    ins(`INSERT INTO product_groups(name,sort_order,created_at,updated_at) VALUES(?,0,?,?)`, name, t, t)
  const g1 = makeGroup('Раф №1')
  const g2 = makeGroup('Раф №2')
  const sameNameGroup1 = ins(
    `INSERT INTO products(name,price,icon,available,category_id,sort_order,created_at,updated_at,
       counts_as_cup,free_eligible,group_id,variant_label,variant_sort,catalog_source)
     VALUES('Раф',100,'Coffee',1,?,0,?,?,1,1,?,'200 мл',0,'SIXTH_CUP')`, catDrinks, t, t, g1)
  const sameNameGroup2 = ins(
    `INSERT INTO products(name,price,icon,available,category_id,sort_order,created_at,updated_at,
       counts_as_cup,free_eligible,group_id,variant_label,variant_sort,catalog_source)
     VALUES('Раф',100,'Coffee',1,?,0,?,?,1,1,?,'200 мл',0,'SIXTH_CUP')`, catDrinks, t, t, g2)

  for (const id of [syrupInAddons, syrupInSecondCategory, retailSameName, ordinary, variantA, variantB, sameNameGroup1, sameNameGroup2]) {
    db.prepare('INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)')
      .run(id, STORE, `uuid-${id}`)
  }

  // Добавка и обычный товар выключены для точки.
  for (const id of [syrupInAddons, ordinary]) {
    db.prepare(`INSERT INTO product_store_availability(product_id,store_uuid,available,updated_at)
                VALUES(?,?,0,?)`).run(id, STORE, t)
  }

  ids = {
    catAddons, catAddons2, catDrinks, syrupInAddons, syrupInSecondCategory, retailSameName, ordinary,
    group, variantA, variantB, sameNameGroup1, sameNameGroup2,
  }
})

describe('классификация добавок не по названию', () => {
  it('скрывает добавки из ВСЕХ категорий-добавок', async () => {
    const j = await catalog()
    expect(j.addonCategoryIds).toEqual(expect.arrayContaining([ids.catAddons, ids.catAddons2]))
    for (const id of [ids.syrupInAddons, ids.syrupInSecondCategory]) {
      expect(byId(j, id)).toMatchObject({ isModifier: true, hideFromMenu: true })
    }
  })

  it('обычный товар с тем же названием не скрывается и не считается добавкой', async () => {
    const j = await catalog()
    expect(byId(j, ids.retailSameName)).toMatchObject({ isModifier: false, hideFromMenu: false })
  })

  it('каждый товар несёт стабильный articleNumber sc-<id>', async () => {
    const j = await catalog()
    for (const p of j.products) expect(p.articleNumber).toBe(productArticleNumber(p.id))
    expect(parseProductArticleNumber(byId(j, ids.variantA).articleNumber)).toBe(ids.variantA)
    expect(parseProductArticleNumber('sc-g-5')).toBeNull()
    expect(parseProductArticleNumber('nonsense')).toBeNull()
  })
})

describe('доступность по точке не теряет флаг скрытия добавки', () => {
  it('выключенная для точки добавка остаётся в каталоге скрытой, обычный товар — отсутствует', async () => {
    const j = await catalog()
    expect(byId(j, ids.syrupInAddons)).toMatchObject({ hideFromMenu: true, isModifier: true })
    expect(byId(j, ids.ordinary)).toBeUndefined()
  })
})

describe('варианты объёма', () => {
  it('оба варианта несут groupId/label, groups[] содержит группу', async () => {
    const j = await catalog()
    expect(byId(j, ids.variantA)).toMatchObject({ groupId: ids.group, variantLabel: 'S' })
    expect(byId(j, ids.variantB)).toMatchObject({ groupId: ids.group, variantLabel: 'L' })
    const g = j.groups.find((x: any) => x.id === ids.group)
    expect(g.variants.map((v: any) => v.productId).sort()).toEqual([ids.variantA, ids.variantB].sort())
  })

  it('два независимых напитка с одинаковым названием не попадают в одну группу', async () => {
    const j = await catalog()
    const a = byId(j, ids.sameNameGroup1)
    const b = byId(j, ids.sameNameGroup2)
    expect(a.name).toBe(b.name)
    expect(a.groupId).not.toBe(b.groupId)
    expect(j.groups.filter((g: any) => [a.groupId, b.groupId].includes(g.id)).every((g: any) => g.variants.length === 1)).toBe(true)
  })
})
