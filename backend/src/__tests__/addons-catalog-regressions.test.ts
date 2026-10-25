import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-addoncat-reg-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

// Dynamic import AFTER env (static import hoists above DB_PATH → would open the real DB)
const { app } = await import('../app')
const { db } = await import('../db')
const { ensureAddonsCategory } = await import('../modules/catalog/addonScheme')

const T = Date.now()
const STORE = 'store-reg-' + T
let seq = 0
const now = () => Date.now() + ++seq

function makeProduct(fields: {
  name: string
  price?: number
  available?: number
  categoryId?: number | null
  schemeId?: number | null
}): number {
  const t = now()
  return Number(
    db
      .prepare(
        `INSERT INTO products(name, price, icon, available, sort_order, category_id, modifier_scheme_id,
                              created_at, updated_at, counts_as_cup, free_eligible)
         VALUES(?,?,?,?,0,?,?,?,?,0,1)`,
      )
      .run(
        fields.name,
        fields.price ?? 0,
        'Coffee',
        fields.available ?? 1,
        fields.categoryId ?? null,
        fields.schemeId ?? null,
        t,
        t,
      ).lastInsertRowid,
  )
}

function makeScheme(name: string): number {
  const t = now()
  return Number(
    db.prepare('INSERT INTO modifier_schemes(name, created_at, updated_at) VALUES(?,?,?)').run(name, t, t).lastInsertRowid,
  )
}

function addOption(schemeId: number, fields: {
  kind: 'product' | 'zero' | 'modifier'
  productId?: number | null
  name?: string | null
  groupKey?: string
  price?: number
  required?: number
  maxCount?: number
  sortOrder?: number
}): number {
  return Number(
    db
      .prepare(
        `INSERT INTO modifier_scheme_options(scheme_id, kind, product_id, name, group_key,
                                             is_default, required, max_count, sort_order)
         VALUES(?,?,?,?,?,0,?,?,?)`,
      )
      .run(
        schemeId,
        fields.kind,
        fields.productId ?? null,
        fields.name ?? null,
        fields.groupKey ?? 'syrup',
        fields.required ?? 0,
        fields.maxCount ?? 1,
        fields.sortOrder ?? 0,
      ).lastInsertRowid,
  )
}

function linkStore(productId: number, uuid: string) {
  db.prepare('INSERT INTO product_store_links(product_id, store_uuid, evotor_uuid) VALUES(?,?,?)').run(
    productId,
    STORE,
    uuid,
  )
}

const catalog = async (storeUuid = STORE) =>
  (await (await app.request('/api/devices/catalog?storeUuid=' + storeUuid)).json()) as any

const toppingsOf = (j: any, productId: number) => (j.products.find((p: any) => p.id === productId)?.toppings ?? []) as any[]

describe('каталог добавок: регрессии F и J', () => {
  it('F: удалённая из схемы опция больше не предлагается кассе', async () => {
    const cat = ensureAddonsCategory(db)
    const syrup = makeProduct({ name: 'Сироп-F-' + T, price: 30, categoryId: cat })
    linkStore(syrup, 'u-syrup-F-' + T)
    const scheme = makeScheme('Схема-F-' + T)
    const optionId = addOption(scheme, { kind: 'product', productId: syrup, name: 'Сироп-F-' + T })
    addOption(scheme, { kind: 'zero', name: 'Без сиропа', groupKey: 'syrup' })
    const drink = makeProduct({ name: 'Латте-F-' + T, price: 250, schemeId: scheme })

    const before = toppingsOf(await catalog(), drink)
    expect(before.map((t) => t.name)).toContain('Сироп-F-' + T)
    expect(before.find((t) => t.name === 'Сироп-F-' + T)).toMatchObject({ available: true, evotorUuid: 'u-syrup-F-' + T })

    db.prepare('DELETE FROM modifier_scheme_options WHERE id=?').run(optionId)

    const after = toppingsOf(await catalog(), drink)
    expect(after.map((t) => t.name)).not.toContain('Сироп-F-' + T)
    // бесплатный вариант остаётся доступным
    expect(after.map((t) => t.name)).toContain('Без сиропа')
  })

  it('J: опция со ссылкой на удалённый товар не роняет каталог и не выдаётся как платная', async () => {
    const cat = ensureAddonsCategory(db)
    const ghost = makeProduct({ name: 'Призрак-J-' + T, price: 40, categoryId: cat })
    const scheme = makeScheme('Схема-J-' + T)
    addOption(scheme, { kind: 'product', productId: ghost, name: 'Призрак-J-' + T })
    addOption(scheme, { kind: 'zero', name: 'Без добавки', groupKey: 'extra' })
    const drink = makeProduct({ name: 'Раф-J-' + T, price: 300, schemeId: scheme })

    db.prepare('DELETE FROM products WHERE id=?').run(ghost) // товар исчез, опция осталась

    const j = await catalog()
    const tops = toppingsOf(j, drink)
    expect(tops.map((t) => t.name)).not.toContain('Призрак-J-' + T)
    // ни одна платная опция не должна быть доступна без идентификатора
    expect(tops.filter((t) => !t.zeroOption && t.available).every((t) => t.evotorUuid != null)).toBe(true)
    expect(tops.map((t) => t.name)).toContain('Без добавки')
  })

  it('required и maxCount из схемы доходят до кассы без искажения', async () => {
    const cat = ensureAddonsCategory(db)
    const syrup = makeProduct({ name: 'Сироп-R-' + T, price: 25, categoryId: cat })
    linkStore(syrup, 'u-syrup-R-' + T)
    const scheme = makeScheme('Схема-R-' + T)
    addOption(scheme, { kind: 'product', productId: syrup, name: 'Сироп-R-' + T, required: 1, maxCount: 3 })
    const drink = makeProduct({ name: 'Капучино-R-' + T, price: 200, schemeId: scheme })

    const t = toppingsOf(await catalog(), drink).find((x) => x.name === 'Сироп-R-' + T)
    expect(t).toMatchObject({ required: true, maxCount: 3 })
  })

  it('недоступный товар добавки (available=0) помечается как недоступный для кассы', async () => {
    const cat = ensureAddonsCategory(db)
    const off = makeProduct({ name: 'Отключённый-' + T, price: 20, categoryId: cat, available: 0 })
    linkStore(off, 'u-off-' + T)
    const scheme = makeScheme('Схема-Off-' + T)
    addOption(scheme, { kind: 'product', productId: off, name: 'Отключённый-' + T })
    const drink = makeProduct({ name: 'Флэт-' + T, price: 220, schemeId: scheme })

    const t = toppingsOf(await catalog(), drink).find((x) => x.name === 'Отключённый-' + T)
    expect(t).toMatchObject({ available: false })
  })
})
