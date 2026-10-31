/**
 * Три независимые системы конфигурации товара: объёмы, молоко, добавки.
 *
 * Контракт каталога кассы:
 *   product.config = { volumes, milk, addons } — каждая группа `null`, если схема не назначена;
 *   `selectionRequired` внутри группы: объёмы и молоко — true, добавки — false.
 *
 * Тесты §6 ТЗ: 11 сценариев от «нет схем» до «обе схемы, молоко выбрано, добавки нет».
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-config-'))
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
const catalog = async (store: string) =>
  (await (await app.request(`/api/devices/catalog?storeUuid=${encodeURIComponent(store)}`)).json()) as any

const T = Date.now()
const STORE = `store-cfg-${T}`

async function mkProduct(name: string, price = 250): Promise<number> {
  const r = await adm('POST', '/products', { name: `${name}-${T}`, price, icon: 'Coffee', available: true })
  expect(r.s).toBeLessThan(400)
  return Number(r.j.id)
}
const link = (id: number, store: string, uuid: string) =>
  db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(id, store, uuid)

async function mkVolumeScheme() {
  const r = await adm('POST', '/volume-schemes', {
    name: `Объёмы-${T}`,
    active: true,
    items: [
      { label: '200 мл', sizeValue: 200, sizeUnit: 'ml', sortOrder: 0, active: true },
      { label: '300 мл', sizeValue: 300, sizeUnit: 'ml', sortOrder: 1, active: true },
    ],
  })
  expect(r.s).toBe(200)
  return r.j.scheme as { id: number; items: { id: number; label: string }[] }
}

async function mkMilkScheme(paidProductId: number) {
  const r = await adm('POST', '/milk-schemes', {
    name: `Молоко-${T}`,
    active: true,
    variants: [
      { label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false, sortOrder: 0, active: true },
      { label: 'Овсяное молоко', isDefault: false, isFree: false, sendToReceipt: true, productId: paidProductId, sortOrder: 1, active: true },
    ],
  })
  expect(r.s).toBe(200)
  return r.j.scheme as { id: number }
}

async function mkAddonScheme(syrupProductId: number) {
  const r = await adm('POST', '/modifier-schemes', {
    name: `Добавки-${T}`,
    options: [
      { kind: 'zero', groupKey: 'syrup', name: 'Без сиропа', isDefault: true, maxCount: 1 },
      { kind: 'product', groupKey: 'syrup', productId: syrupProductId, maxCount: 2 },
    ],
  })
  expect(r.s).toBe(200)
  return Number(r.j.id)
}

const saveProduct = (id: number, extra: Record<string, unknown>) =>
  adm('POST', '/products', { id, name: `Drink-${id}`, price: 250, icon: 'Coffee', available: true, ...extra })

const findProduct = async (id: number) => (await catalog(STORE)).products.find((x: any) => x.id === id)

beforeEach(() => {
  db.prepare("INSERT OR IGNORE INTO evotor_stores(store_uuid,name,sync_enabled) VALUES(?,?,1)").run(STORE, 'Точка')
})

describe('§6 контракт каталога: три группы конфигурации', () => {
  it('1. товар без схем — все три группы null, секций на кассе нет', async () => {
    const drink = await mkProduct('Пустой')
    link(drink, STORE, `empty-${drink}`)
    const p = await findProduct(drink)
    expect(p.config).toEqual({ volumes: null, milk: null, addons: null })
    expect(p.volumes).toEqual([])
    expect(p.milk).toEqual([])
    expect(p.toppings).toEqual([])
  })

  it('2. только схема объёмов — volumes есть, milk и addons null', async () => {
    const scheme = await mkVolumeScheme()
    const drink = await mkProduct('Только-объёмы')
    link(drink, STORE, `vol-${drink}`)
    await saveProduct(drink, { volumeSchemeId: scheme.id })

    const p = await findProduct(drink)
    expect(p.config.volumes).toMatchObject({ schemeId: scheme.id, selectionRequired: true })
    expect(p.config.volumes.options.map((o: any) => o.label)).toEqual(['200 мл', '300 мл'])
    expect(p.config.volumes.options[0]).toMatchObject({ price: 250, isDefault: true })
    expect(p.config.milk).toBeNull()
    expect(p.config.addons).toBeNull()
  })

  it('3. только схема молока — milk обязателен к выбору, объёмы и добавки null', async () => {
    const paid = await mkProduct('Овсяное-товар', 60)
    link(paid, STORE, `oat-${T}`)
    const milk = await mkMilkScheme(paid)
    const drink = await mkProduct('Только-молоко')
    link(drink, STORE, `milk-${drink}`)
    await saveProduct(drink, { milkSchemeId: milk.id })

    const p = await findProduct(drink)
    expect(p.config.milk).toMatchObject({ schemeId: milk.id, selectionRequired: true })
    expect(p.config.milk.options[0]).toMatchObject({ label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false })
    expect(p.config.volumes).toBeNull()
    expect(p.config.addons).toBeNull()
  })

  it('4. обе схемы — группы независимы, у каждой свои опции', async () => {
    const paid = await mkProduct('Овсяное-2', 60)
    link(paid, STORE, `oat2-${T}`)
    const milk = await mkMilkScheme(paid)
    const syrup = await mkProduct('Сироп-2', 40)
    link(syrup, STORE, `syrup2-${T}`)
    const addons = await mkAddonScheme(syrup)
    const drink = await mkProduct('Обе-схемы')
    link(drink, STORE, `both-${drink}`)
    await saveProduct(drink, { milkSchemeId: milk.id, modifierSchemeId: addons })

    const p = await findProduct(drink)
    expect(p.config.milk.schemeId).toBe(milk.id)
    expect(p.config.addons.schemeId).toBe(addons)
    expect(p.config.addons.selectionRequired).toBe(false)
    expect(p.milkSchemeId).toBe(milk.id)
    expect(p.config.milk.schemeId).toBe(milk.id)
  })

  it('5. объёмы: цена берётся из карточки товара, базовой остаётся только непереопределённая', async () => {
    const scheme = await mkVolumeScheme()
    const drink = await mkProduct('Цены-объёмов', 300)
    link(drink, STORE, `vp-${drink}`)
    await saveProduct(drink, {
      price: 300,
      volumeSchemeId: scheme.id,
      volumePrices: [{ itemId: scheme.items[0].id, price: 280 }],
    })
    const p = await findProduct(drink)
    expect(p.config.volumes.options[0].price).toBe(280)
    expect(p.config.volumes.options[1].price).toBe(300)
  })

  it('6. снятие назначения объёмов — группа снова null', async () => {
    const scheme = await mkVolumeScheme()
    const drink = await mkProduct('Снять-объёмы')
    link(drink, STORE, `unvol-${drink}`)
    await saveProduct(drink, { volumeSchemeId: scheme.id })
    expect((await findProduct(drink)).config.volumes).not.toBeNull()

    await saveProduct(drink, { volumeSchemeId: null })
    const p = await findProduct(drink)
    expect(p.config.volumes).toBeNull()
    expect(p.volumeSchemeId).toBeNull()
  })

  it('7. выключенная схема объёмов кассе не отдаётся, назначение остаётся', async () => {
    const scheme = await mkVolumeScheme()
    const drink = await mkProduct('Выкл-объёмы')
    link(drink, STORE, `offvol-${drink}`)
    await saveProduct(drink, { volumeSchemeId: scheme.id })
    await adm('POST', '/volume-schemes', { id: scheme.id, name: `Объёмы-${T}`, active: false, items: scheme.items })

    const p = await findProduct(drink)
    expect(p.config.volumes).toBeNull()
    expect(p.config.volumes ?? null).toBeNull()
    expect(p.volumes).toEqual([])
    expect(p.volumeSchemeId).toBe(scheme.id)
  })

  it('8. добавки без схемы молока не требуют выбора (selectionRequired=false)', async () => {
    const syrup = await mkProduct('Сироп-8', 40)
    link(syrup, STORE, `syrup8-${T}`)
    const addons = await mkAddonScheme(syrup)
    const drink = await mkProduct('Только-добавки')
    link(drink, STORE, `add8-${drink}`)
    await saveProduct(drink, { modifierSchemeId: addons })

    const p = await findProduct(drink)
    expect(p.config.addons).toMatchObject({ schemeId: addons, selectionRequired: false })
    expect(p.config.addons.options.length).toBeGreaterThan(0)
    expect(p.config.milk).toBeNull()
  })

  it('9. платное молоко отдаёт UUID товара этой точки', async () => {
    const paid = await mkProduct('Овсяное-9', 60)
    link(paid, STORE, `oat9-${T}`)
    const milk = await mkMilkScheme(paid)
    const drink = await mkProduct('Платное-молоко')
    link(drink, STORE, `paid9-${drink}`)
    await saveProduct(drink, { milkSchemeId: milk.id })

    const paidOption = (await findProduct(drink)).config.milk.options.find((o: any) => o.sendToReceipt)
    expect(paidOption.evotorUuid).toBe(`oat9-${T}`)
    expect(paidOption.available).toBe(true)
  })

  it('10. обычное молоко бесплатное и без UUID (в чек не уходит)', async () => {
    const paid = await mkProduct('Овсяное-10', 60)
    link(paid, STORE, `oat10-${T}`)
    const milk = await mkMilkScheme(paid)
    const drink = await mkProduct('Обычное-молоко')
    link(drink, STORE, `free10-${drink}`)
    await saveProduct(drink, { milkSchemeId: milk.id })

    const free = (await findProduct(drink)).config.milk.options.find((o: any) => o.isFree)
    expect(free).toMatchObject({ isDefault: true, isFree: true, sendToReceipt: false, evotorUuid: null })
  })

  it('11. добавки отдают UUID реального товара точки', async () => {
    const syrup = await mkProduct('Сироп-11', 40)
    link(syrup, STORE, `syrup11-${T}`)
    const addons = await mkAddonScheme(syrup)
    const drink = await mkProduct('Добавки-uuid')
    link(drink, STORE, `add11-${drink}`)
    await saveProduct(drink, { modifierSchemeId: addons })

    const withUuid = (await findProduct(drink)).config.addons.options.filter((o: any) => o.evotorUuid)
    expect(withUuid.length).toBeGreaterThan(0)
    expect(withUuid[0].evotorUuid).toBe(`syrup11-${T}`)
  })
})

describe('CRUD схем объёмов', () => {
  it('создание, правка, запрет удаления занятой схемы', async () => {
    const scheme = await mkVolumeScheme()
    const drink = await mkProduct('Занят-объёмами')
    await saveProduct(drink, { volumeSchemeId: scheme.id })
    expect((await adm('DELETE', `/volume-schemes/${scheme.id}`)).s).toBe(409)

    const edited = await adm('POST', '/volume-schemes', {
      id: scheme.id, name: 'Объёмы-правка', active: true,
      items: [{ label: '400 мл', sizeValue: 400, sizeUnit: 'ml', sortOrder: 0, active: true }],
    })
    expect(edited.s).toBe(200)
    expect(edited.j.scheme.items).toHaveLength(1)

    await saveProduct(drink, { volumeSchemeId: null })
    expect((await adm('DELETE', `/volume-schemes/${scheme.id}`)).s).toBe(200)
  })

  it('валидация: пустое имя, без объёмов, дубликаты, число без единицы', async () => {
    expect((await adm('POST', '/volume-schemes', { name: ' ', active: true, items: [{ label: '200 мл' }] })).s).toBe(400)
    expect((await adm('POST', '/volume-schemes', { name: 'X', active: true, items: [] })).s).toBe(400)
    const dup = await adm('POST', '/volume-schemes', {
      name: 'Dup', active: true,
      items: [{ label: '200 мл' }, { label: '200мл' }],
    })
    expect(dup.s).toBe(400)
    expect(String(dup.j.error)).toMatch(/дважды/i)
    const half = await adm('POST', '/volume-schemes', {
      name: 'Half', active: true, items: [{ label: '250', sizeValue: 250, sizeUnit: null }],
    })
    expect(half.s).toBe(400)
  })
})
