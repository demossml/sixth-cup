/**
 * Server-driven catalog (фаза 1): sellable / notReadyReason / features.serverCatalog,
 * zeroOption без uuid, uuid добавок строго по точке из запроса.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-srvcat-'))
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
const STORE_A = `store-srvA-${T}`
const STORE_B = `store-srvB-${T}`
const STORE_EMPTY = `store-srvEmpty-${T}`

const catalog = async (store: string, headers: Record<string, string> = {}, query = '') => {
  const url = `/api/devices/catalog?storeUuid=${encodeURIComponent(store)}${query}`
  return (await (await app.request(url, { headers })).json()) as any
}

async function mkProduct(name: string, price = 250): Promise<number> {
  const r = await adm('POST', '/products', { name: `${name}-${T}`, price, icon: 'Coffee', available: true })
  expect(r.s).toBeLessThan(400)
  return Number(r.j.id)
}

function link(productId: number, store: string, uuid: string) {
  db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)')
    .run(productId, store, uuid)
}

async function mkModifier(name: string, groupKey: string, price = 40): Promise<{ modifierId: number; linkedProductId: number }> {
  expect((await adm('POST', '/modifiers', { name: `${name}-${T}`, price, groupKey })).s).toBe(200)
  const m = ((await adm('GET', '/modifiers')).j.modifiers as any[]).find((x) => x.name === `${name}-${T}`)
  return { modifierId: Number(m.id), linkedProductId: Number(m.linkedProductId) }
}

async function mkScheme(name: string, options: unknown[]): Promise<number> {
  const r = await adm('POST', '/modifier-schemes', { name: `${name}-${T}`, options })
  expect(r.s).toBe(200)
  return Number(r.j.id)
}

const find = (j: any, name: string) => (j.products as any[]).find((p) => String(p.name).startsWith(name))

describe('STEP-B1: sellable и notReadyReason в products[]', () => {
  it('товар с uuid на точке — sellable, без uuid — нет, но остаётся в JSON', async () => {
    const withUuid = await mkProduct('SrvA-есть-uuid')
    link(withUuid, STORE_A, `u-${withUuid}`)
    const withoutUuid = await mkProduct('SrvA-без-uuid')

    const j = await catalog(STORE_A)
    const ok = find(j, 'SrvA-есть-uuid')
    const notOk = find(j, 'SrvA-без-uuid')

    expect(ok).toMatchObject({ sellable: true, notReadyReason: null, evotorUuid: `u-${withUuid}` })
    expect(notOk).toBeTruthy() // позицию не выкидываем
    expect(notOk.sellable).toBe(false)
    expect(notOk.notReadyReason).toBe('no_store_link')
  })

  it('связь есть, но uuid пустой (после wipe) → no_evotor_uuid', async () => {
    const id = await mkProduct('SrvA-пустой-uuid')
    db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,NULL)')
      .run(id, STORE_A)
    const p = find(await catalog(STORE_A), 'SrvA-пустой-uuid')
    expect(p.sellable).toBe(false)
    expect(p.notReadyReason).toBe('no_evotor_uuid')
  })

  it('notReadySummary перечисляет неготовые позиции с причиной', async () => {
    const id = await mkProduct('SrvA-сводка')
    db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,NULL)')
      .run(id, STORE_A)
    const j = await catalog(STORE_A)
    expect(Array.isArray(j.notReadySummary)).toBe(true)
    const row = (j.notReadySummary as any[]).find((r) => r.productId === id)
    expect(row).toMatchObject({ productId: id, reason: 'no_evotor_uuid' })
    expect(j.notReadySummary.length).toBeLessThanOrEqual(50)
  })
})

describe('STEP-B1: features.serverCatalog', () => {
  it('по умолчанию false', async () => {
    expect((await catalog(STORE_A)).features).toEqual({ serverCatalog: false })
  })

  it('включается query-параметром', async () => {
    expect((await catalog(STORE_A, {}, '&serverCatalog=1')).features.serverCatalog).toBe(true)
  })

  it('включается заголовком версии кассы ≥ 140', async () => {
    expect((await catalog(STORE_A, { 'X-App-Version-Code': '140' })).features.serverCatalog).toBe(true)
    expect((await catalog(STORE_A, { 'X-App-Version-Code': '139' })).features.serverCatalog).toBe(false)
    expect((await catalog(STORE_A, { 'X-App-Version-Code': 'abc' })).features.serverCatalog).toBe(false)
  })
})

describe('STEP-B4: готовность к выгрузке в админ-API', () => {
  it('GET /admin/products отдаёт evotorReady и причину', async () => {
    const ok = await mkProduct('SrvB4-готов')
    link(ok, STORE_A, `u-b4-${ok}`)
    const noLink = await mkProduct('SrvB4-нет-связи')

    const j = (await adm('GET', '/products')).j as { products: any[] }
    const good = j.products.find((p) => p.id === ok)
    const bad = j.products.find((p) => p.id === noLink)
    expect(good).toMatchObject({ evotorReady: true, evotorReadyReason: null })
    expect(bad).toMatchObject({ evotorReady: false, evotorReadyReason: 'no_store_link' })
  })

  it('связь с пустым uuid → no_evotor_uuid', async () => {
    const id = await mkProduct('SrvB4-пустой')
    db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,NULL)')
      .run(id, STORE_A)
    const j = (await adm('GET', '/products')).j as { products: any[] }
    expect(j.products.find((p) => p.id === id)).toMatchObject({ evotorReady: false, evotorReadyReason: 'no_evotor_uuid' })
  })
})

describe('STEP-B2: uuid добавок строго по точке из запроса', () => {
  it('две точки — разные uuid; точка без связи получает null и available=false у платной', async () => {
    const milk = await mkModifier('МолокоSrv', 'milk', 50)
    link(milk.linkedProductId, STORE_A, 'milk-A')
    link(milk.linkedProductId, STORE_B, 'milk-B')
    const scheme = await mkScheme('SrvScheme', [
      { kind: 'modifier', modifierId: milk.modifierId, groupKey: 'milk' },
      { kind: 'zero', name: 'Обычное', groupKey: 'milk' },
    ])
    const drink = await mkProduct('SrvA-капучино')
    link(drink, STORE_A, `u-capp-${T}`)
    await adm('POST', '/products', {
      id: drink, name: `SrvA-капучино-${T}`, price: 250, icon: 'Coffee', available: true, modifierSchemeId: scheme,
    })

    const a = find(await catalog(STORE_A), 'SrvA-капучино')
    const b = find(await catalog(STORE_B), 'SrvA-капучино')
    const milkA = (a.toppings as any[]).find((t) => t.groupKey === 'milk' && !t.zeroOption)
    const milkB = (b.toppings as any[]).find((t) => t.groupKey === 'milk' && !t.zeroOption)

    expect(milkA).toMatchObject({ evotorUuid: 'milk-A', available: true })
    expect(milkB).toMatchObject({ evotorUuid: 'milk-B', available: true })

    const c = find(await catalog(STORE_EMPTY), 'SrvA-капучино')
    const milkC = (c.toppings as any[]).find((t) => t.groupKey === 'milk' && !t.zeroOption)
    expect(milkC.evotorUuid).toBeNull()
    expect(milkC.available).toBe(false)
    expect(milkC.notReadyReason).toBe('no_evotor_uuid')
  })

  it('zeroOption не требует uuid и всегда доступна', async () => {
    const j = await catalog(STORE_EMPTY)
    const drink = (j.products as any[]).find((p) => String(p.name).startsWith('SrvA-капучино'))
    const zero = (drink.toppings as any[]).find((t) => t.zeroOption)
    expect(zero).toBeTruthy()
    expect(zero.evotorUuid).toBeNull()
    expect(zero.available).toBe(true)
    expect(zero.notReadyReason).toBeNull()
  })
})
