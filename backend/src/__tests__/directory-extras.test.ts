/**
 * Витрина: «нет в наличии», медиа товара (фото/видео), часы точки по дням и geo-эндпоинт
 * для выбора кофейни. Всё правится из админки — здесь проверяем, что доезжает до гостя.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-dirx-'))
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
const uniq = (p: string) => `${p}-${T}`
const STORE_UUID = `store-x-${T}`

let storeId = 0
let productId = 0

beforeEach(async () => {
  if (!storeId) {
    const org = await adm('POST', '/organizations', { name: uniq('ООО'), legalName: uniq('ООО'), inn: '7701234567' })
    const st = await adm('POST', '/stores', {
      name: uniq('Точка'), address: 'ул. Тест, 1', organizationId: Number(org.j.id),
      openTime: '08:00', closeTime: '21:00', lat: 55.75, lng: 37.61,
      hoursJson: [
        { open: '08:00', close: '21:00' },
        { open: '08:00', close: '21:00' },
        { open: '08:00', close: '21:00' },
        { open: '08:00', close: '21:00' },
        { open: '08:00', close: '21:00' },
        { open: '10:00', close: '18:00' },
        null,
      ],
    })
    expect(st.s).toBe(200)
    storeId = Number(st.j.id)
    db.prepare('INSERT OR REPLACE INTO evotor_stores(store_uuid,name,local_store_id,updated_at) VALUES(?,?,?,?)')
      .run(STORE_UUID, 'Точка', storeId, T)
    const p = await adm('POST', '/products', {
      name: uniq('Капучино'), price: 300, icon: 'Coffee', available: true,
      mediaType: 'video', videoUrl: '/uploads/cap.mp4', posterUrl: '/uploads/cap.jpg',
    })
    expect(p.s).toBe(200)
    productId = Number(p.j.id)
  }
})

describe('часы по дням и geo', () => {
  it('часы точки отдаются массивом из 7 дней (null — выходной)', async () => {
    const j = (await (await app.request('/api/directory')).json()) as any
    const store = (j.stores as any[]).find((s) => s.id === storeId)
    expect(store.hours).toHaveLength(7)
    expect(store.hours[5]).toEqual({ open: '10:00', close: '18:00' })
    expect(store.hours[6]).toBeNull()
  })

  it('geo отдаёт координаты и часы, без персональных данных', async () => {
    const r = await app.request('/api/directory/geo')
    expect(r.status).toBe(200)
    const j = (await r.json()) as any
    const s = (j.stores as any[]).find((x) => x.id === storeId)
    expect(s).toMatchObject({ lat: 55.75, lng: 37.61, openTime: '08:00', closeTime: '21:00' })
    expect(s.hours).toHaveLength(7)
    expect(JSON.stringify(s)).not.toMatch(/card|user|token/i)
  })

  it('невалидные часы в админке — 400', async () => {
    const bad = await adm('PATCH', `/stores/${storeId}`, { hoursJson: [{ open: '08:00', close: '21:00' }] })
    expect(bad.s).toBe(400)
  })
})

describe('медиа товара', () => {
  it('видео и постер доезжают до витрины', async () => {
    const j = (await (await app.request('/api/directory')).json()) as any
    const p = (j.products as any[]).find((x) => Number(x.id) === productId)
    expect(p.mediaType).toBe('video')
    expect(String(p.videoUrl)).toContain('/uploads/cap.mp4')
    expect(String(p.posterUrl)).toContain('/uploads/cap.jpg')
  })

  it('по умолчанию тип медиа — фото', async () => {
    const id = Number((await adm('POST', '/products', { name: uniq('Латте'), price: 290, icon: 'Coffee', available: true })).j.id)
    const j = (await (await app.request('/api/directory')).json()) as any
    const p = (j.products as any[]).find((x) => Number(x.id) === id)
    expect(p.mediaType).toBe('image')
    expect(p.videoUrl).toBeNull()
  })
})

describe('нет в наличии', () => {
  it('глобально выключенный товар помечается soldOut, а не исчезает', async () => {
    await adm('POST', '/products', { id: productId, name: uniq('Капучино'), price: 300, icon: 'Coffee', available: false })
    const j = (await (await app.request('/api/directory')).json()) as any
    const p = (j.products as any[]).find((x) => Number(x.id) === productId)
    expect(p).toBeTruthy()
    expect(p.soldOut).toBe(true)
    await adm('POST', '/products', { id: productId, name: uniq('Капучино'), price: 300, icon: 'Coffee', available: true })
  })

  it('стоп на точке тоже даёт soldOut, товар остаётся в каталоге', async () => {
    // Стоп-лист точки: админка пишет сюда же, нам важен результат в витрине.
    db.prepare('INSERT OR REPLACE INTO product_store_availability(product_id, store_uuid, available, updated_at) VALUES(?,?,?,?)')
      .run(productId, STORE_UUID, 0, T)
    const j = (await (await app.request(`/api/directory?storeUuid=${STORE_UUID}`)).json()) as any
    const p = (j.products as any[]).find((x) => Number(x.id) === productId)
    expect(p).toBeTruthy()
    expect(p.soldOut).toBe(true)
    db.prepare('DELETE FROM product_store_availability WHERE product_id=?').run(productId)
  })
})
