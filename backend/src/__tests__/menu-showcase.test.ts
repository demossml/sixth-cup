/**
 * Витрина меню 1:1 с макетом: КБЖУ, «Популярное», бейджи, часы точки, гостевой конфиг товара.
 *
 * Проверяем то, что редактируется в админке и должно доезжать до PWA:
 *  • новые поля товара (proteinG/fatG/carbsG, isPopular, badge) и точки (openTime/closeTime/lat/lng);
 *  • GET /api/directory/config/:productId — объёмы, молоко с доплатой, выбор без цены, добавки;
 *  • отдачу этих данных в /api/directory (для сетки меню и выбора кофейни).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-menu-showcase-'))
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
const mkAllow = (name: string) => `${name}-${T}`

async function mkProduct(body: Record<string, unknown> = {}): Promise<number> {
  const r = await adm('POST', '/products', {
    name: mkAllow('Товар'), price: 260, icon: 'Coffee', available: true, ...body,
  })
  expect(r.s).toBe(200)
  return Number(r.j.id)
}

const configOf = async (productId: number) => {
  const r = await app.request(`/api/directory/config/${productId}`)
  return { s: r.status, j: (await r.json().catch(() => ({}))) as any }
}

let storeId = 0

beforeEach(async () => {
  if (!storeId) {
    const org = await adm('POST', '/organizations', {
      name: mkAllow('ООО Витрина'), legalName: mkAllow('ООО Витрина'), inn: '7701234567',
    })
    expect(org.s).toBe(200)
    const st = await adm('POST', '/stores', {
      name: mkAllow('Точка'), address: 'ул. Витрина, 1', organizationId: Number(org.j.id),
      openTime: '08:00', closeTime: '21:00', lat: 55.75, lng: 37.61,
    })
    expect(st.s).toBe(200)
    storeId = Number(st.j.id)
  }
})

describe('A: поля витрины в админке', () => {
  it('КБЖУ, «Популярное» и бейдж сохраняются и возвращаются', async () => {
    const id = await mkProduct({
      price: 300, calories: 120, proteinG: 6.4, fatG: 5.1, carbsG: 10.2, isPopular: true, badge: 'hit',
    })
    const list = (await adm('GET', '/products')).j.products as any[]
    const row = list.find((p) => Number(p.id) === id)
    expect(row).toMatchObject({ calories: 120, proteinG: 6.4, fatG: 5.1, carbsG: 10.2, isPopular: 1, badge: 'hit' })
  })

  it('бейдж принимает только известные значения', async () => {
    const r = await adm('POST', '/products', {
      name: mkAllow('Бейдж'), price: 100, icon: 'Coffee', available: true, badge: 'super',
    })
    expect(r.s).toBe(400)
  })

  it('часы и координаты точки: сохранение, чтение, сброс и валидация', async () => {
    const ok = await adm('PATCH', `/stores/${storeId}`, { openTime: '09:30', closeTime: '20:00', lat: 59.93, lng: 30.31 })
    expect(ok.s).toBe(200)
    let st = (await adm('GET', `/stores/${storeId}`)).j.store
    expect(st).toMatchObject({ openTime: '09:30', closeTime: '20:00', lat: 59.93, lng: 30.31 })

    const bad = await adm('PATCH', `/stores/${storeId}`, { openTime: '25:00' })
    expect(bad.s).toBe(400)

    // null сбрасывает, undefined — «не трогать»
    await adm('PATCH', `/stores/${storeId}`, { openTime: null })
    st = (await adm('GET', `/stores/${storeId}`)).j.store
    expect(st.openTime).toBeNull()
    expect(st.closeTime).toBe('20:00')
    await adm('PATCH', `/stores/${storeId}`, { openTime: '08:00' })
  })
})

describe('B: гостевой конфиг товара', () => {
  it('объёмы из схемы объёмов с ценами конкретного товара', async () => {
    const scheme = await adm('POST', '/volume-schemes', {
      name: mkAllow('Объёмы'),
      items: [
        { label: '200 мл', sizeValue: 200, sizeUnit: 'ml', sortOrder: 0 },
        { label: '300 мл', sizeValue: 300, sizeUnit: 'ml', sortOrder: 1 },
        { label: '400 мл', sizeValue: 400, sizeUnit: 'ml', sortOrder: 2 },
      ],
    })
    expect(scheme.s).toBe(200)
    const schemeId = Number(scheme.j.scheme.id)
    const items = (await adm('GET', '/volume-schemes')).j.schemes.find((s: any) => Number(s.id) === schemeId).items
    const id = await mkProduct({
      volumeSchemeId: schemeId,
      volumePrices: items.map((it: any, i: number) => ({ itemId: Number(it.id), price: 260 + i * 40 })),
    })

    const { s, j } = await configOf(id)
    expect(s).toBe(200)
    expect(j.volumes.map((v: any) => [v.label, v.priceRub])).toEqual([
      ['200 мл', 260],
      ['300 мл', 300],
      ['400 мл', 340],
    ])
    expect(j.volumes[0].isDefault).toBe(true)
    expect(j.volumes[0].skuProductId).toBe(id)
  })

  it('молоко: бесплатное и платное с доплатой из привязанного товара', async () => {
    const oat = await mkProduct({ name: mkAllow('Молоко овсяное'), price: 40 })
    const scheme = await adm('POST', '/milk-schemes', {
      name: mkAllow('Молоко'),
      variants: [
        { label: 'Обычное', isDefault: true, isFree: true, sendToReceipt: false },
        { label: 'Овсяное', productId: oat, isFree: false },
      ],
    })
    expect(scheme.s).toBe(200)
    const schemeId = Number(scheme.j.scheme.id ?? scheme.j.id)
    const id = await mkProduct({ milkSchemeId: schemeId })

    const { j } = await configOf(id)
    expect(j.milk.required).toBe(true)
    const byLabel = Object.fromEntries((j.milk.options as any[]).map((o) => [o.label, o]))
    expect(byLabel['Обычное']).toMatchObject({ priceRub: 0, isDefault: true })
    expect(byLabel['Овсяное']).toMatchObject({ priceRub: 40, isDefault: false })
  })

  it('обязательный выбор без цены и добавки с лимитом количества', async () => {
    const syrup = await adm('POST', '/modifiers', { name: mkAllow('Ваниль'), price: 30, groupKey: 'syrup' })
    expect(syrup.s).toBe(200)
    const modifierId = Number(
      ((await adm('GET', '/modifiers')).j.modifiers as any[]).find((m) => m.name === mkAllow('Ваниль')).id,
    )
    const addonScheme = await adm('POST', '/modifier-schemes', {
      name: mkAllow('Добавки'),
      options: [{ kind: 'modifier', modifierId, groupKey: 'syrup', maxCount: 2, required: false }],
    })
    expect(addonScheme.s).toBe(200)
    const choice = await adm('POST', '/choice-schemes', {
      name: mkAllow('Корица'),
      title: 'Корица',
      active: true,
      options: [
        { label: 'С корицей', isDefault: true, sortOrder: 0, active: true },
        { label: 'Без корицы', isDefault: false, sortOrder: 1, active: true },
      ],
    })
    expect(choice.s).toBe(200)
    const choiceId = Number(choice.j.scheme.id)

    const id = await mkProduct({
      modifierSchemeId: Number(addonScheme.j.id),
      choiceSchemeId: choiceId,
    })
    const { j } = await configOf(id)

    expect(j.choice).toMatchObject({ title: 'Корица' })
    expect((j.choice.options as any[]).map((o) => o.label)).toEqual(['С корицей', 'Без корицы'])

    expect(j.addons).toHaveLength(1)
    expect(j.addons[0]).toMatchObject({ key: 'syrup', label: 'Сиропы', required: false })
    const vanilla = (j.addons[0].options as any[]).find((o) => o.name === mkAllow('Ваниль'))
    expect(vanilla).toMatchObject({ priceRub: 30, maxCount: 2 })
  })

  it('машинный ключ группы не утекает в витрину: extra → «Добавки»', async () => {
    await adm('POST', '/modifiers', { name: mkAllow('Корица'), price: 20, groupKey: 'extra' })
    const all = (await adm('GET', '/modifiers')).j.modifiers as any[]
    const cinnamonId = Number(all.find((m) => m.name === mkAllow('Корица')).id)
    const scheme = await adm('POST', '/modifier-schemes', {
      name: mkAllow('Группы'),
      options: [{ kind: 'modifier', modifierId: cinnamonId, groupKey: 'extra', maxCount: 2, required: false }],
    })
    const id = await mkProduct({ modifierSchemeId: Number(scheme.j.id) })
    const { j } = await configOf(id)
    const labels = Object.fromEntries((j.addons as any[]).map((g) => [g.key, g.label]))
    expect(labels.extra).toBe('Добавки')
    expect(Object.values(labels)).not.toContain('extra')
  })

  it('товар без схем — один базовый объём, без молока и добавок', async () => {
    const id = await mkProduct({ price: 190 })
    const { j } = await configOf(id)
    expect(j.volumes).toHaveLength(1)
    expect(j.volumes[0]).toMatchObject({ id: 'base', priceRub: 190, skuProductId: id })
    expect(j.milk).toBeNull()
    expect(j.addons).toBeNull()
    expect(j.choice).toBeNull()
  })

  it('несуществующий товар — 404, кривой id — 400', async () => {
    expect((await configOf(999999)).s).toBe(404)
    const r = await app.request('/api/directory/config/abc')
    expect(r.status).toBe(400)
  })
})

describe('C: /api/directory отдаёт данные витрины', () => {
  it('товар: КБЖУ, «Популярное», бейдж; точка: часы и координаты', async () => {
    const id = await mkProduct({ isPopular: true, badge: 'seasonal', calories: 90, proteinG: 1.5, fatG: 2.5, carbsG: 3.5 })
    const j = (await (await app.request('/api/directory')).json()) as any
    const product = (j.products as any[]).find((p) => Number(p.id) === id)
    expect(product).toMatchObject({
      isPopular: true, badge: 'seasonal', calories: 90, proteinG: 1.5, fatG: 2.5, carbsG: 3.5,
    })
    const store = (j.stores as any[]).find((s) => Number(s.id) === storeId)
    expect(store).toMatchObject({ openTime: '08:00', closeTime: '20:00', lat: 59.93, lng: 30.31 })
  })
})
