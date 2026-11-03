/**
 * «Готовность кассы» — диагностика для админки, посчитанная по нашей модели данных:
 * молоко в `milk_schemes`, объёмы в схеме-шаблоне, UUID в `product_store_links` точки.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-ready-'))
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
const STORE = `ready-${T}`
const STORE_EMPTY = `ready-empty-${T}`

const link = (productId: number, store: string, uuid: string | null) =>
  db
    .prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)')
    .run(productId, store, uuid)

const mkProduct = async (name: string, price = 250) => {
  const r = await adm('POST', '/products', { name: `${name}-${T}`, price, icon: 'Coffee', available: true })
  expect(r.s).toBeLessThan(400)
  return Number(r.j.id)
}

const card = (id: number, store: string) =>
  adm('GET', `/catalog/product/${id}/card?storeUuid=${encodeURIComponent(store)}`)

describe('GET /admin/catalog/product/:id/card', () => {
  it('товар без связей с точкой — no_store_link и ready=false', async () => {
    const id = await mkProduct('Без-связей')
    const r = await card(id, STORE)
    expect(r.s).toBe(200)
    expect(r.j.ready).toBe(false)
    expect(r.j.volumes[0]).toMatchObject({ productId: id, ready: false, reason: 'no_store_link' })
  })

  it('связь есть, uuid пустой — no_evotor_uuid', async () => {
    const id = await mkProduct('Пустой-uuid')
    link(id, STORE, null)
    const r = await card(id, STORE)
    expect(r.j.volumes[0]).toMatchObject({ ready: false, reason: 'no_evotor_uuid' })
  })

  it('связь с uuid — готово', async () => {
    const id = await mkProduct('Готовый')
    link(id, STORE, `u-ready-${id}`)
    const r = await card(id, STORE)
    expect(r.j.ready).toBe(true)
    expect(r.j.volumes[0]).toMatchObject({ ready: true, reason: null, evotorUuid: `u-ready-${id}` })
  })

  it('пустая назначенная схема молока — milk_scheme_empty', async () => {
    const id = await mkProduct('Пустое-молоко')
    link(id, STORE, `u-milk-${id}`)
    const scheme = Number((await adm('POST', '/milk-schemes', {
      name: `Молоко-пусто-${T}`, active: false,
      variants: [{ label: 'Обычное', isDefault: true, isFree: true, sendToReceipt: false }],
    })).j.scheme.id)
    await adm('POST', '/products', { id, name: `Пустое-молоко-${T}`, price: 250, milkSchemeId: scheme })
    const r = await card(id, STORE)
    expect(r.j.ready).toBe(false)
    expect(r.j.notReady.some((e: any) => e.reason === 'milk_scheme_empty')).toBe(true)
  })

  it('платное молоко без uuid точки — no_store_link, бесплатное всегда готово', async () => {
    const paid = await mkProduct('Овсяное', 60)
    const id = await mkProduct('Капучино-молоко')
    link(id, STORE, `u-capp-${id}`)
    const scheme = Number((await adm('POST', '/milk-schemes', {
      name: `Молоко-${T}`, active: true,
      variants: [
        { label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false },
        { label: 'Овсяное молоко', isFree: false, sendToReceipt: true, productId: paid },
      ],
    })).j.scheme.id)
    await adm('POST', '/products', { id, name: `Капучино-молоко-${T}`, price: 250, milkSchemeId: scheme })

    const bad = await card(id, STORE)
    expect(bad.j.milk.options.find((o: any) => o.isFree)).toMatchObject({ ready: true })
    expect(bad.j.milk.options.find((o: any) => !o.isFree)).toMatchObject({ ready: false, reason: 'no_evotor_uuid' })

    link(paid, STORE, `u-oat-${T}`)
    const good = await card(id, STORE)
    expect(good.j.ready).toBe(true)
  })

  it('платная добавка без uuid — попадает в notReady, zero-опция готова', async () => {
    const syrup = await mkProduct('Сироп', 40)
    const id = await mkProduct('Капучино-добавки')
    link(id, STORE, `u-add-${id}`)
    const scheme = Number((await adm('POST', '/modifier-schemes', {
      name: `Сиропы-${T}`,
      options: [
        { kind: 'zero', groupKey: 'syrup', name: 'Без сиропа', isDefault: true },
        { kind: 'product', groupKey: 'syrup', productId: syrup, maxCount: 2 },
      ],
    })).j.id)
    await adm('POST', '/products', { id, name: `Капучино-добавки-${T}`, price: 250, modifierSchemeId: scheme })

    const r = await card(id, STORE)
    expect(r.j.addons.options.find((o: any) => o.name === 'Без сиропа')).toMatchObject({ ready: true })
    expect(r.j.addons.options.find((o: any) => o.name === `Сироп-${T}`)).toMatchObject({ ready: false })
    expect(r.j.notReady.some((e: any) => e.kind === 'addon')).toBe(true)
  })

  it('несуществующий товар — 404', async () => {
    const r = await adm('GET', `/catalog/product/999999/card?storeUuid=${STORE}`)
    expect(r.s).toBe(404)
  })
})

describe('GET /admin/catalog/readiness', () => {
  it('сводка считает карточки и собирает причины без дублей', async () => {
    const ok = await mkProduct('Сводка-ок')
    link(ok, STORE, `u-sum-ok-${ok}`)
    const broken = await mkProduct('Сводка-нет')
    const r = await adm('GET', `/catalog/readiness?storeUuid=${encodeURIComponent(STORE)}`)
    expect(r.s).toBe(200)
    expect(r.j.storeUuid).toBe(STORE)
    expect(r.j.cards).toBeGreaterThan(0)
    expect(r.j.readyCards).toBeGreaterThan(0)
    expect(r.j.notReady.some((e: any) => e.productId === broken && e.reason === 'no_store_link')).toBe(true)

    const keys = r.j.notReady.map((e: any) => `${e.kind}:${e.productId ?? e.name}:${e.reason}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('точка без связей — всё в no_store_link (кроме карточек без схем)', async () => {
    const r = await adm('GET', `/catalog/readiness?storeUuid=${encodeURIComponent(STORE_EMPTY)}`)
    expect(r.s).toBe(200)
    expect(r.j.readyCards).toBe(0)
    // причина только из известного набора: данных для этой точки нет ни у кого
    const reasons = new Set((r.j.notReady as any[]).map((e) => e.reason))
    expect([...reasons].every((x) => ['no_store_link', 'no_evotor_uuid', 'milk_scheme_empty', 'unavailable'].includes(x as string))).toBe(true)
    expect(reasons.has('no_store_link')).toBe(true)
  })

  it('без storeUuid — проверка «есть ли товар в Эвотор хоть где-то»', async () => {
    const ready = await adm('GET', '/catalog/readiness')
    expect(ready.s).toBe(200)
    expect(ready.j.storeUuid).toBeNull()
    expect(ready.j.cards).toBeGreaterThan(0)
  })

  it('товары-добавки и группы не считаются карточками', async () => {
    const addonsCategory = db.prepare("SELECT id FROM categories WHERE name='Добавки'").get() as { id: number } | undefined
    if (!addonsCategory) return
    const before = (await adm('GET', '/catalog/readiness')).j.cards as number
    await adm('POST', '/products', { name: `Добавка-${T}`, price: 10, categoryId: addonsCategory.id })
    const after = (await adm('GET', '/catalog/readiness')).j.cards as number
    expect(after).toBe(before)
  })
})

describe('дедупликация опций в предпросмотре', () => {
  it('два объёма с одной схемой молока и добавок — опции показаны один раз', async () => {
    const oat = await mkProduct('Овсяное-дедуп', 60)
    link(oat, STORE, `u-oatd-${T}`)
    const syrup = await mkProduct('Сироп-дедуп', 40)
    link(syrup, STORE, `u-syrd-${T}`)
    const milk = Number((await adm('POST', '/milk-schemes', {
      name: `Молоко-дедуп-${T}`, active: true,
      variants: [
        { label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false },
        { label: 'Овсяное молоко', isFree: false, sendToReceipt: true, productId: oat },
      ],
    })).j.scheme.id)
    const addons = Number((await adm('POST', '/modifier-schemes', {
      name: `Сиропы-дедуп-${T}`,
      options: [
        { kind: 'zero', groupKey: 'syrup', name: 'Без сиропа', isDefault: true },
        { kind: 'product', groupKey: 'syrup', productId: syrup },
      ],
    })).j.id)

    const g = await adm('POST', '/product-groups', {
      name: `Дедуп-${T}`, icon: 'Coffee', sortOrder: 0, variantLabelFormat: undefined,
      milkSchemeId: milk, modifierSchemeId: addons,
      variants: [{ label: '250 мл', price: 250 }, { label: '350 мл', price: 300 }],
    })
    const rows = ((await adm('GET', '/product-groups')).j.groups as any[]).find((x) => x.id === g.j.id).variants as any[]
    for (const v of rows) link(v.id, STORE, `u-dedup-${v.id}`)

    const r = await card(rows[0].id, STORE)
    expect(r.j.ready).toBe(true)
    expect(r.j.volumes).toHaveLength(2)
    expect(r.j.milk.options.map((o: any) => o.name)).toEqual(['Обычное молоко', 'Овсяное молоко'])
    expect(r.j.addons.options.map((o: any) => o.name)).toEqual(['Без сиропа', `Сироп-дедуп-${T}`])
  })
})
