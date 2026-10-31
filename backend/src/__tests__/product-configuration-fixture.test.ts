/**
 * Фикстура контракта: полный JSON ответа
 * GET /api/devices/products/:id/configuration?storeUuid=
 *
 * Фикстура согласуется с APK-агентом: любое изменение формы ответа
 * ломает этот тест. Перегенерировать осознанно:
 *   WRITE_FIXTURE=1 DB_PATH=$(mktemp -u /tmp/xx.db) npx vitest run product-configuration-fixture
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-pcfx-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { config } = await import('../config')
const { db } = await import('../db')

const FIXTURE = join(import.meta.dirname, 'fixtures', 'product-configuration-fixture.json')
const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const adm = async (m: string, p: string, b?: unknown) => {
  const r = await app.request('/api/admin' + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, j: (await r.json().catch(() => ({}))) as any }
}
const link = (productId: number, store: string, uuid: string) =>
  db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(productId, store, uuid)

const STORE = 'store-config-fixture'
const STORE_B = 'store-config-fixture-b'

describe('фикстура контракта конфигурации', () => {
  it('ответ каталога конфигурации равен фикстуре', async () => {
    for (const s of [STORE, STORE_B]) {
      db.prepare('INSERT OR IGNORE INTO evotor_stores(store_uuid,name,sync_enabled) VALUES(?,?,1)').run(s, 'Точка фикстуры')
    }
    const oat = Number((await adm('POST', '/products', { name: 'Овсяное молоко', price: 60, icon: 'Bottle', available: true })).j.id)
    const coconut = Number((await adm('POST', '/products', { name: 'Кокосовое молоко', price: 70, icon: 'Bottle', available: true })).j.id)
    const syrup = Number((await adm('POST', '/products', { name: 'Ванильный сироп', price: 50, icon: 'Droplet', available: true })).j.id)

    const milk = Number(
      (
        await adm('POST', '/milk-schemes', {
          name: 'Молоко фикстуры',
          active: true,
          variants: [
            { label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false, sortOrder: 0, active: true },
            { label: 'Овсяное молоко', isDefault: false, isFree: false, sendToReceipt: true, productId: oat, sortOrder: 1, active: true },
            { label: 'Кокосовое молоко', isDefault: false, isFree: false, sendToReceipt: true, productId: coconut, sortOrder: 2, active: true },
          ],
        })
      ).j.scheme.id,
    )

    const addons = Number(
      (
        await adm('POST', '/modifier-schemes', {
          name: 'Добавки фикстуры',
          options: [
            { kind: 'zero', groupKey: 'syrup', name: 'Без сиропа', isDefault: true, maxCount: 1 },
            { kind: 'product', groupKey: 'syrup', productId: syrup, maxCount: 1 },
          ],
        })
      ).j.id,
    )

    for (const [store, tag] of [[STORE, 'A'], [STORE_B, 'B']] as const) {
      link(oat, store, `OAT-${tag}-UUID`)
      link(coconut, store, `COCONUT-${tag}-UUID`)
      link(syrup, store, `VANILLA-${tag}-UUID`)
    }

    const group = await adm('POST', '/product-groups', {
      name: 'Капучино', icon: 'Coffee', sortOrder: 0, countsAsCup: true, freeEligible: true,
      variants: [{ label: '250 мл', price: 250 }, { label: '350 мл', price: 300 }, { label: '450 мл', price: 350 }],
    })
    expect(group.s).toBe(200)
    const variants = ((await adm('GET', '/product-groups')).j.groups as any[]).find((g) => g.id === group.j.id).variants as any[]
    for (const v of variants) {
      for (const [store, tag] of [[STORE, 'A'], [STORE_B, 'B']] as const) link(v.id, store, `CAPP-${tag}-${v.label}`)
      await adm('POST', '/products', {
        id: v.id, name: v.name, price: v.price, icon: 'Coffee', available: true,
        milkSchemeId: milk, modifierSchemeId: addons,
      })
    }

    const res = await app.request(`/api/devices/products/${variants[0].id}/configuration?storeUuid=${STORE}`, {
      headers: { Authorization: 'Bearer proxy-secret' },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    // Метка времени зависит от запуска — в фикстуре фиксируем 0.
    json.generatedAt = 0

    if (process.env.WRITE_FIXTURE === '1' || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, JSON.stringify(json, null, 2) + '\n')
    }
    expect(json).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')))
  })
})
