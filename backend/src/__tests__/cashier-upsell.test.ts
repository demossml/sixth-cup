/**
 * Рекомендации на кассе (upsell): рубильник на точку + явные списки товаров.
 * Пока выключено, каталог отдаёт пустые upsell/upsellDefault — старые APK тоже молчат.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-cashier-upsell-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const { runMigrations } = await import('../db/migrate')
const { app } = await import('../app')
const { getCashierUpsell, hasStoreUpsell, setCashierUpsell } = await import('../lib/cashierUpsell')

const A = 'store-upsell-a'
const B = 'store-upsell-b'

const admin = (method: string, path: string, body?: unknown) =>
  app.request(`/api/admin${path}`, {
    method,
    headers: { 'X-Admin-Token': 'test-admin', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const catalog = async (store: string) =>
  (await (await app.request(`/api/devices/catalog?storeUuid=${store}`)).json()) as any

const ins = (sql: string, ...a: unknown[]) => Number(db.prepare(sql).run(...a).lastInsertRowid)

let bun = 0
let eclair = 0
let syrup = 0
let cup = 0

beforeAll(() => {
  runMigrations(db)
  db.prepare('DELETE FROM app_settings WHERE key LIKE ?').run('cashier_upsell%')
  const t = Date.now()
  const coffee = ins(`INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES('Кофе',1,1,?,?)`, t, t)
  const food = ins(`INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES('Выпечка',2,1,?,?)`, t, t)
  const addons = ins(`INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES('Добавки',3,1,?,?)`, t, t)
  const prod = (name: string, price: number, categoryId: number, countsAsCup = 0) =>
    ins(
      `INSERT INTO products(name, price, available, category_id, counts_as_cup, sort_order, created_at, updated_at)
       VALUES(?,?,1,?,?,0,?,?)`,
      name,
      price,
      categoryId,
      countsAsCup,
      t,
      t,
    )
  cup = prod('Капучино', 200, coffee, 1)
  bun = prod('Круассан', 120, food)
  eclair = prod('Эклер', 150, food)
  syrup = prod('Сироп ваниль', 40, addons)
  db.prepare('INSERT INTO product_store_links(product_id, store_uuid, evotor_uuid) VALUES(?,?,?)').run(bun, A, 'uuid-bun-a')
})

describe('хранилище настроек upsell', () => {
  it('по умолчанию выключено и пусто', () => {
    expect(getCashierUpsell(A)).toEqual({ enabled: false, defaultProductIds: [], byProductId: {} })
    expect(hasStoreUpsell(A)).toBe(false)
  })

  it('сохраняет и читает настройку точки', () => {
    const saved = setCashierUpsell({ enabled: true, defaultProductIds: [bun], byProductId: { [cup]: [eclair] } }, A)
    expect(saved).toEqual({ enabled: true, defaultProductIds: [bun], byProductId: { [String(cup)]: [eclair] } })
    expect(getCashierUpsell(A)).toEqual(saved)
    expect(hasStoreUpsell(A)).toBe(true)
    // другая точка не видит чужую настройку
    expect(getCashierUpsell(B).enabled).toBe(false)
    setCashierUpsell({ enabled: false, defaultProductIds: [], byProductId: {} }, A)
  })

  it('битый JSON не роняет каталог — читаем как заводскую настройку', () => {
    db.prepare(`INSERT INTO app_settings(key, value, updated_at) VALUES('cashier_upsell:store-broken','{oops',?)
                ON CONFLICT(key) DO UPDATE SET value='{oops'`).run(Date.now())
    expect(getCashierUpsell('store-broken')).toEqual({ enabled: false, defaultProductIds: [], byProductId: {} })
  })
})

describe('каталог: рубильник upsell', () => {
  it('выключено — списки пустые у каждого товара и в корне', async () => {
    const j = await catalog(A)
    expect(j.upsellEnabled).toBe(false)
    expect(j.upsell).toEqual({ enabled: false, defaults: [] })
    expect(j.upsellDefault).toEqual([])
    for (const p of j.products) expect(p.upsell).toEqual([])
  })

  it('включено + список «к любому заказу» — рекомендации появляются и в корне, и у товаров', async () => {
    const r = await admin('PUT', '/cashier/upsell', {
      storeUuid: A,
      enabled: true,
      defaultProductIds: [bun, eclair],
      byProductId: { [cup]: [eclair] },
    })
    expect(r.status).toBe(200)

    const j = await catalog(A)
    expect(j.upsellEnabled).toBe(true)
    expect(j.upsell.enabled).toBe(true)
    expect(j.upsell.defaults.map((u: any) => u.id)).toEqual([bun, eclair])
    expect(j.upsellDefault.map((u: any) => u.id)).toEqual([bun, eclair])

    const cap = j.products.find((p: any) => p.id === cup)
    // «к товару» первым, дальше общий список; сам товар из своих рекомендаций исключён
    expect(cap.upsell.map((u: any) => u.id)).toEqual([eclair, bun])
    const bunRow = j.products.find((p: any) => p.id === bun)
    expect(bunRow.upsell.map((u: any) => u.id)).toEqual([eclair])

    // другая точка рубильник не наследует
    const other = await catalog(B)
    expect(other.upsellEnabled).toBe(false)
    expect(other.products.every((p: any) => p.upsell.length === 0)).toBe(true)
  })

  it('добавки в рекомендации не попадают', async () => {
    const r = await admin('PUT', '/cashier/upsell', {
      storeUuid: A,
      enabled: true,
      defaultProductIds: [bun, syrup],
    })
    expect(r.status).toBe(200)
    const out = (await r.json()) as any
    expect(out.defaultProductIds).toEqual([bun])
    expect(out.skipped.join(' ')).toMatch(/добавка/)
    const j = await catalog(A)
    expect(j.products.find((p: any) => p.id === cup).upsell.map((u: any) => u.id)).not.toContain(syrup)
  })

  it('несуществующий товар — 400', async () => {
    const r = await admin('PUT', '/cashier/upsell', { storeUuid: A, enabled: true, defaultProductIds: [999999] })
    expect(r.status).toBe(400)
    const r2 = await admin('PUT', '/cashier/upsell', { storeUuid: A, enabled: true, byProductId: { '999999': [bun] } })
    expect(r2.status).toBe(400)
  })
})

describe('админка: чтение и сброс', () => {
  it('GET отдаёт настройку с названиями и справочник товаров', async () => {
    await admin('PUT', '/cashier/upsell', { storeUuid: A, enabled: true, defaultProductIds: [bun] })
    const j = (await (await admin('GET', `/cashier/upsell?storeUuid=${A}`)).json()) as any
    expect(j.storeUuid).toBe(A)
    expect(j.own).toBe(true)
    expect(j.enabled).toBe(true)
    expect(j.defaultProductIds).toEqual([bun])
    expect(j.defaults.map((p: any) => p.name)).toEqual(['Круассан'])
    expect(j.limit).toEqual({ defaults: 12, perProduct: 6 })
    expect(j.products.map((p: any) => p.id)).toContain(bun)
    // добавки в справочнике рекомендаций не предлагаются
    expect(j.products.map((p: any) => p.id)).not.toContain(syrup)
  })

  it('DELETE сбрасывает точку на общую настройку', async () => {
    expect((await admin('DELETE', `/cashier/upsell?storeUuid=${A}`)).status).toBe(200)
    expect(hasStoreUpsell(A)).toBe(false)
    const j = await catalog(A)
    expect(j.upsellEnabled).toBe(false)
    expect(j.upsell.defaults).toEqual([])
    // без точки — понятная ошибка
    expect((await admin('DELETE', '/cashier/upsell')).status).toBe(400)
  })

  it('общая настройка наследуется точками без своей', async () => {
    expect((await admin('PUT', '/cashier/upsell', { enabled: true, defaultProductIds: [eclair] })).status).toBe(200)
    const j = await catalog('store-upsell-c')
    expect(j.upsellEnabled).toBe(true)
    expect(j.upsell.defaults.map((u: any) => u.id)).toEqual([eclair])
    db.prepare(`DELETE FROM app_settings WHERE key='cashier_upsell'`).run()
  })
})
