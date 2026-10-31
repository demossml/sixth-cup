/**
 * Схема молока: отдельная сущность, независимая от схемы добавок.
 * Проверяем CRUD, назначение товару, выдачу в каталог кассы и бизнес-правила
 * (обычное молоко бесплатно и не уходит в чек, платное требует UUID точки).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-milk-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.ADMIN_MARKETER_TOKEN = 'mgr-token'
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
const STORE = `store-milk-${T}`
const STORE_B = `store-milkB-${T}`

async function mkProduct(name: string, price = 250): Promise<number> {
  const r = await adm('POST', '/products', { name: `${name}-${T}`, price, icon: 'Coffee', available: true })
  expect(r.s).toBeLessThan(400)
  return Number(r.j.id)
}
const link = (id: number, store: string, uuid: string) =>
  db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(id, store, uuid)

/** Схема: обычное молоко (бесплатное, по умолчанию) + платное кокосовое с товаром. */
async function mkScheme(paidProductId: number | null, opts: { name?: string } = {}) {
  const r = await adm('POST', '/milk-schemes', {
    name: opts.name ?? `Молоко-${T}`,
    active: true,
    variants: [
      { label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false, sortOrder: 0, active: true },
      { label: 'Кокосовое молоко', isDefault: false, isFree: false, sendToReceipt: true, productId: paidProductId, sortOrder: 1, active: true },
    ],
  })
  expect(r.s).toBe(200)
  return r.j.scheme as { id: number; name: string; variants: any[] }
}

beforeEach(() => {
  db.prepare("INSERT OR IGNORE INTO evotor_stores(store_uuid,name,sync_enabled) VALUES(?,?,1)").run(STORE, 'Точка')
  db.prepare("INSERT OR IGNORE INTO evotor_stores(store_uuid,name,sync_enabled) VALUES(?,?,1)").run(STORE_B, 'Точка Б')
})

describe('CRUD схем молока', () => {
  it('создаёт схему с вариантами и отдаёт её в списке', async () => {
    const paid = await mkProduct('Кокос-товар', 60)
    const scheme = await mkScheme(paid)
    expect(scheme.variants).toHaveLength(2)
    expect(scheme.variants[0]).toMatchObject({ label: 'Обычное молоко', isFree: true, isDefault: true, sendToReceipt: false })
    const list = (await adm('GET', '/milk-schemes')).j.schemes as any[]
    expect(list.some((s) => s.id === scheme.id)).toBe(true)
  })

  it('редактирование заменяет варианты целиком', async () => {
    const paid = await mkProduct('Кокос-2', 60)
    const scheme = await mkScheme(paid)
    const r = await adm('POST', '/milk-schemes', {
      id: scheme.id, name: 'Молоко-изм', active: true,
      variants: [{ label: 'Безлактозное', isDefault: true, isFree: true, sendToReceipt: false }],
    })
    expect(r.s).toBe(200)
    expect(r.j.scheme.variants).toHaveLength(1)
    expect(r.j.scheme.name).toBe('Молоко-изм')
  })

  it('выключенная схема остаётся в списке, но не отдаётся кассе', async () => {
    const paid = await mkProduct('Кокос-3', 60)
    const scheme = await mkScheme(paid)
    await adm('POST', '/milk-schemes', { id: scheme.id, name: scheme.name, active: false, variants: scheme.variants.map((v) => ({ ...v })) })
    const drink = await mkProduct('Капучино-off')
    link(drink, STORE, `u-off-${drink}`)
    await adm('POST', '/products', { id: drink, name: `Капучино-off-${T}`, price: 250, icon: 'Coffee', available: true, milkSchemeId: scheme.id })
    const p = (await catalog(STORE)).products.find((x: any) => x.id === drink)
    expect(p.milk).toEqual([])
    expect(p.milkSchemeId).toBe(scheme.id)
  })

  it('удаление схемы, назначенной товару, запрещено', async () => {
    const paid = await mkProduct('Кокос-4', 60)
    const scheme = await mkScheme(paid)
    const drink = await mkProduct('Капучино-del')
    await adm('POST', '/products', { id: drink, name: `Капучино-del-${T}`, price: 250, icon: 'Coffee', available: true, milkSchemeId: scheme.id })
    const del = await adm('DELETE', `/milk-schemes/${scheme.id}`)
    expect(del.s).toBe(409)
    expect(String(del.j.error ?? '')).toMatch(/назначена/i)
  })

  it('удаление свободной схемы проходит', async () => {
    const paid = await mkProduct('Кокос-5', 60)
    const scheme = await mkScheme(paid)
    expect((await adm('DELETE', `/milk-schemes/${scheme.id}`)).s).toBe(200)
    expect(((await adm('GET', '/milk-schemes')).j.schemes as any[]).some((s) => s.id === scheme.id)).toBe(false)
  })
})

describe('назначение схемы товару и каталог', () => {
  it('товар без схемы — milk пустой массив', async () => {
    const drink = await mkProduct('Без-молока')
    const p = (await catalog(STORE)).products.find((x: any) => x.id === drink)
    expect(p.milk).toEqual([])
    expect(p.milkSchemeId).toBeNull()
  })

  it('товар со схемой: обычное молоко по умолчанию и без чека, платное — с UUID точки', async () => {
    const paid = await mkProduct('Кокос-6', 60)
    link(paid, STORE, `coconut-A-${T}`)
    link(paid, STORE_B, `coconut-B-${T}`)
    const scheme = await mkScheme(paid)
    const drink = await mkProduct('Капучино-молоко')
    link(drink, STORE, `u-capp-${T}`)
    await adm('POST', '/products', { id: drink, name: `Капучино-молоко-${T}`, price: 250, icon: 'Coffee', available: true, milkSchemeId: scheme.id })

    const a = (await catalog(STORE)).products.find((x: any) => x.id === drink)
    expect(a.milk).toHaveLength(2)
    expect(a.milk[0]).toMatchObject({ label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false, evotorUuid: null })
    expect(a.milk[1]).toMatchObject({ label: 'Кокосовое молоко', sendToReceipt: true, evotorUuid: `coconut-A-${T}`, available: true })

    // другая точка — свой UUID
    const b = (await catalog(STORE_B)).products.find((x: any) => x.id === drink)
    expect(b.milk[1].evotorUuid).toBe(`coconut-B-${T}`)
  })

  it('платное молоко без UUID на точке помечается недоступным, а не подменяется', async () => {
    const paid = await mkProduct('Кокос-7', 60) // ни одной связи
    const scheme = await mkScheme(paid)
    const drink = await mkProduct('Капучино-nouuid')
    await adm('POST', '/products', { id: drink, name: `Капучино-nouuid-${T}`, price: 250, icon: 'Coffee', available: true, milkSchemeId: scheme.id })

    const p = (await catalog(STORE)).products.find((x: any) => x.id === drink)
    const paidVariant = p.milk.find((v: any) => v.sendToReceipt)
    expect(paidVariant.evotorUuid).toBeNull()
    expect(paidVariant.available).toBe(false)
    expect(paidVariant.notReadyReason).toBe('no_evotor_uuid')
  })

  it('снятие назначения (milkSchemeId: null) очищает схему', async () => {
    const paid = await mkProduct('Кокос-8', 60)
    const scheme = await mkScheme(paid)
    const drink = await mkProduct('Капучино-unassign')
    await adm('POST', '/products', { id: drink, name: `Капучино-unassign-${T}`, price: 250, icon: 'Coffee', available: true, milkSchemeId: scheme.id })
    await adm('POST', '/products', { id: drink, name: `Капучино-unassign-${T}`, price: 250, icon: 'Coffee', available: true, milkSchemeId: null })
    const p = (await catalog(STORE)).products.find((x: any) => x.id === drink)
    expect(p.milkSchemeId).toBeNull()
    expect(p.milk).toEqual([])
  })

  it('схема молока не смешивается со схемой добавок', async () => {
    const paid = await mkProduct('Кокос-9', 60)
    const scheme = await mkScheme(paid)
    const drink = await mkProduct('Капучино-mix')
    await adm('POST', '/products', { id: drink, name: `Капучино-mix-${T}`, price: 250, icon: 'Coffee', available: true, milkSchemeId: scheme.id })
    const p = (await catalog(STORE)).products.find((x: any) => x.id === drink)
    expect(p.toppings).toEqual([]) // схема добавок не назначена
    expect(p.milk).toHaveLength(2)
  })
})

describe('валидация бизнес-правил', () => {
  const post = (body: unknown) => adm('POST', '/milk-schemes', body)

  it('пустая схема отклоняется', async () => {
    expect((await post({ name: 'X', active: true, variants: [] })).s).toBe(400)
  })

  it('два варианта по умолчанию отклоняются', async () => {
    const r = await post({
      name: 'Dup-default', active: true,
      variants: [
        { label: 'A', isDefault: true, isFree: true, sendToReceipt: false },
        { label: 'B', isDefault: true, isFree: true, sendToReceipt: false },
      ],
    })
    expect(r.s).toBe(400)
    expect(String(r.j.error)).toMatch(/по умолчанию/i)
  })

  it('бесплатный вариант с передачей в чек отклоняется', async () => {
    const r = await post({ name: 'Free-receipt', active: true, variants: [{ label: 'A', isFree: true, sendToReceipt: true, productId: null }] })
    expect(r.s).toBe(400)
    expect(String(r.j.error)).toMatch(/бесплатный/i)
  })

  it('платный вариант без товара отклоняется', async () => {
    const r = await post({ name: 'Paid-no-product', active: true, variants: [{ label: 'A', isFree: false, sendToReceipt: true, productId: null }] })
    expect(r.s).toBe(400)
    expect(String(r.j.error)).toMatch(/товар/i)
  })

  it('несуществующий товар отклоняется', async () => {
    const r = await post({ name: 'Ghost', active: true, variants: [{ label: 'A', isFree: false, sendToReceipt: true, productId: 999999 }] })
    expect(r.s).toBe(400)
    expect(String(r.j.error)).toMatch(/не найден/i)
  })

  it('дубликат товара в двух вариантах отклоняется', async () => {
    const paid = await mkProduct('Кокос-dup', 60)
    const r = await post({
      name: 'Dup-product', active: true,
      variants: [
        { label: 'A', isFree: false, sendToReceipt: true, productId: paid },
        { label: 'B', isFree: false, sendToReceipt: true, productId: paid },
      ],
    })
    expect(r.s).toBe(400)
    expect(String(r.j.error)).toMatch(/уже привязан/i)
  })

  it('manager получает 403 на запись схемы', async () => {
    const r = await app.request('/api/admin/milk-schemes', {
      method: 'POST',
      headers: { 'X-Admin-Token': 'mgr-token', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'M', active: true, variants: [{ label: 'A', isFree: true, sendToReceipt: false }] }),
    })
    expect(r.status).toBe(403)
  })
})
