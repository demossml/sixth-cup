import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-addons-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

// Dynamic import AFTER env (static import hoists above DB_PATH → would open the real DB)
const { app } = await import('../app')
const { config } = await import('../config')
const { db } = await import('../db')

const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const adm = async (m: string, p: string, b?: unknown) => {
  const r = await app.request('/api/admin' + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, j: (await r.json().catch(() => ({}))) as any }
}
const T = Date.now()
const STORE = 'store-single-' + T
const catalog = async () => (await (await app.request('/api/devices/catalog?storeUuid=' + STORE)).json()) as any

describe('один вход: админ вводит добавки → касса получает опции', () => {
  let oat = 0, lav = 0, cin = 0, caramel = 0, scheme = 0, raf = 0, oatProd = 0, lavProd = 0, cinProd = 0, karProd = 0

  it('добавка в справочнике сама создаёт товар в категории «Добавки» (категория создаётся сама)', async () => {
    expect((await adm('POST', '/modifiers', { name: 'Овсяное-' + T, price: 40, groupKey: 'milk' })).s).toBe(200)
    expect((await adm('POST', '/modifiers', { name: 'Лаванда-' + T, price: 30, groupKey: 'syrup' })).s).toBe(200)
    expect((await adm('POST', '/modifiers', { name: 'Корица-' + T, price: 20, groupKey: 'topping' })).s).toBe(200)
    const mods = (await adm('GET', '/modifiers')).j.modifiers as any[]
    const by = (n: string) => mods.find((m) => m.name === n + '-' + T)
    oat = by('Овсяное').id; lav = by('Лаванда').id; cin = by('Корица').id
    oatProd = by('Овсяное').linkedProductId; lavProd = by('Лаванда').linkedProductId; cinProd = by('Корица').linkedProductId
    expect(oatProd && lavProd && cinProd).toBeTruthy()
    const cat = db.prepare("SELECT id,name FROM categories WHERE name='Добавки'").get() as any
    expect(cat).toBeTruthy()
    const p = db.prepare('SELECT category_id c, counts_as_cup cc, free_eligible fe, price, available FROM products WHERE id=?').get(oatProd) as any
    expect([p.c, p.cc, p.fe, p.price, p.available]).toEqual([cat.id, 0, 0, 40, 1])
  })

  it('розничный товар с тем же именем НЕ уезжает в «Добавки»: создаётся отдельный товар-добавка', async () => {
    // Решение владельца (A1): переносим только товары, уже лежащие в «Добавках».
    const t = Date.now()
    const cat = db.prepare("SELECT id FROM categories WHERE name='Добавки'").get() as any
    karProd = Number(db.prepare(`INSERT INTO products(name,price,icon,available,sort_order,created_at,updated_at,counts_as_cup,free_eligible) VALUES(?,?,?,1,0,?,?,0,1)`).run('Карамель-' + T, 35, 'Coffee', t, t).lastInsertRowid)
    caramel = Number(db.prepare(`INSERT INTO modifiers(name,price,group_key,available,sort_order,created_at,updated_at) VALUES(?,?,?,1,0,?,?)`).run('карамель-' + T.toString(), 35, 'syrup', t, t).lastInsertRowid)
    const before = (db.prepare('SELECT COUNT(*) n FROM products').get() as any).n
    const r = await adm('POST', '/modifiers/backfill-products')
    expect(r.s).toBe(200)

    const m = db.prepare('SELECT linked_product_id l FROM modifiers WHERE id=?').get(caramel) as any
    expect(m.l).not.toBe(karProd) // розничный товар не забрали
    expect((db.prepare('SELECT COUNT(*) n FROM products').get() as any).n).toBe(before + 1)

    const retail = db.prepare('SELECT category_id c, price, counts_as_cup cc FROM products WHERE id=?').get(karProd) as any
    expect([retail.c, retail.price, retail.cc]).toEqual([null, 35, 0]) // розница без изменений

    const linked = db.prepare('SELECT category_id c, price, counts_as_cup cc, free_eligible fe FROM products WHERE id=?').get(m.l) as any
    expect([linked.c, linked.price, linked.cc, linked.fe]).toEqual([cat.id, 35, 0, 0])

    karProd = m.l // дальше по файлу это уже товар-добавка
    const again = await adm('POST', '/modifiers/backfill-products') // идемпотентность
    expect((db.prepare('SELECT COUNT(*) n FROM products').get() as any).n).toBe(before + 1)
    expect(again.j.ok).toBe(true)
  })

  it('товар, который уже лежит в «Добавках», переиспользуется без дубля', async () => {
    const t = Date.now()
    const cat = db.prepare("SELECT id FROM categories WHERE name='Добавки'").get() as any
    const prod = Number(db.prepare(`INSERT INTO products(name,price,icon,available,sort_order,category_id,created_at,updated_at,counts_as_cup,free_eligible) VALUES(?,?,?,1,0,?,?,?,0,0)`).run('Ваниль-' + T, 12, 'Coffee', cat.id, t, t).lastInsertRowid)
    const mod = Number(db.prepare(`INSERT INTO modifiers(name,price,group_key,available,sort_order,created_at,updated_at) VALUES(?,?,?,1,0,?,?)`).run('Ваниль-' + T, 12, 'syrup', t, t).lastInsertRowid)
    const before = (db.prepare('SELECT COUNT(*) n FROM products').get() as any).n
    await adm('POST', '/modifiers/backfill-products')
    expect((db.prepare('SELECT linked_product_id l FROM modifiers WHERE id=?').get(mod) as any).l).toBe(prod)
    expect((db.prepare('SELECT COUNT(*) n FROM products').get() as any).n).toBe(before)
  })

  it('товар, уже занятый другой добавкой, не отбирается', async () => {
    const t = Date.now()
    const cat = db.prepare("SELECT id FROM categories WHERE name='Добавки'").get() as any
    const prod = Number(db.prepare(`INSERT INTO products(name,price,icon,available,sort_order,category_id,created_at,updated_at,counts_as_cup,free_eligible) VALUES(?,?,?,1,0,?,?,?,0,0)`).run('Мята-' + T, 15, 'Coffee', cat.id, t, t).lastInsertRowid)
    const mk = (n: string) => Number(db.prepare(`INSERT INTO modifiers(name,price,group_key,available,sort_order,created_at,updated_at) VALUES(?,?,?,1,0,?,?)`).run(n, 15, 'syrup', t, t).lastInsertRowid)
    const first = mk('Мята-' + T)
    await adm('POST', '/modifiers/backfill-products')
    const firstLink = (db.prepare('SELECT linked_product_id l FROM modifiers WHERE id=?').get(first) as any).l
    expect(firstLink).toBe(prod)

    const second = mk('Мята-' + T) // то же имя, но товар уже занят
    await adm('POST', '/modifiers/backfill-products')
    const secondLink = (db.prepare('SELECT linked_product_id l FROM modifiers WHERE id=?').get(second) as any).l
    expect(secondLink).not.toBeNull()
    expect(secondLink).not.toBe(firstLink)
  })

  it('A2: две добавки не могут ссылаться на один товар (уникальный индекс)', async () => {
    const t = Date.now()
    const cat = db.prepare("SELECT id FROM categories WHERE name='Добавки'").get() as any
    const prod = Number(db.prepare(`INSERT INTO products(name,price,icon,available,sort_order,category_id,created_at,updated_at,counts_as_cup,free_eligible) VALUES(?,?,?,1,0,?,?,?,0,0)`).run('Дубль-' + T, 5, 'Coffee', cat.id, t, t).lastInsertRowid)
    const mk = (n: string) => Number(db.prepare(`INSERT INTO modifiers(name,price,group_key,available,sort_order,created_at,updated_at) VALUES(?,?,?,1,0,?,?)`).run(n, 5, 'syrup', t, t).lastInsertRowid)
    const a = mk('Дубль-A-' + T)
    const b = mk('Дубль-B-' + T)
    db.prepare('UPDATE modifiers SET linked_product_id=? WHERE id=?').run(prod, a)
    expect(() => db.prepare('UPDATE modifiers SET linked_product_id=? WHERE id=?').run(prod, b)).toThrow()
  })

  it('схема из чекбоксов Studio (modifierIds) + товар → до выгрузки опции недоступны, но zero есть', async () => {
    scheme = (await adm('POST', '/modifier-schemes', { name: 'Кофе-' + T, modifierIds: [oat, lav, cin] })).j.id
    raf = (await adm('POST', '/products', { name: 'Раф-' + T, price: 300, modifierSchemeId: scheme, countsAsCup: true, freeEligible: true })).j.id
    const j = await catalog()
    const p = j.products.find((x: any) => x.id === raf)
    const tops = p.toppings as any[]
    const paid = tops.filter((t) => !t.zeroOption)
    expect(paid.length).toBe(3)
    expect(paid.every((t) => t.evotorUuid === null && t.available === false)).toBe(true) // ещё не выгружено в Эвотор
    const zeros = tops.filter((t) => t.zeroOption)
    expect(zeros.map((z) => [z.groupKey, z.name, z.isDefault]).sort()).toEqual([['milk', 'Обычное', true], ['syrup', 'Без сиропа', true]])
  })

  it('после выгрузки на точку (появилась связь) опции продаются, добавки скрыты, лояльность цела', async () => {
    const link = db.prepare('INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)')
    link.run(oatProd, STORE, 'u-oat-' + T); link.run(lavProd, STORE, 'u-lav-' + T); link.run(cinProd, STORE, 'u-cin-' + T)
    const j = await catalog()
    const p = j.products.find((x: any) => x.id === raf)
    const by = (n: string) => p.toppings.find((t: any) => t.name === n + '-' + T)
    expect(by('Овсяное')).toMatchObject({ evotorUuid: 'u-oat-' + T, available: true, groupKey: 'milk', price: 40 })
    expect(by('Лаванда')).toMatchObject({ evotorUuid: 'u-lav-' + T, available: true, groupKey: 'syrup' })
    expect(by('Корица')).toMatchObject({ evotorUuid: 'u-cin-' + T, available: true, groupKey: 'extra' })
    for (const id of [oatProd, lavProd, cinProd, karProd]) {
      const x = j.products.find((q: any) => q.id === id)
      expect(x.hideFromMenu).toBe(true); expect(x.isModifier).toBe(true); expect(x.countsAsCup).toBe(false); expect(x.freeEligible).toBe(false)
    }
    expect(j.categories.map((c: any) => c.name)).not.toContain('Добавки')
    expect(p.countsAsCup).toBe(true); expect(p.freeEligible).toBe(true)
    expect(p.upsell.map((u: any) => u.id)).not.toContain(oatProd)
  })

  it('другая точка не получает чужой uuid', async () => {
    const j = (await (await app.request('/api/devices/catalog?storeUuid=other-' + T)).json()) as any
    const p = j.products.find((x: any) => x.id === raf)
    expect(p.toppings.filter((t: any) => !t.zeroOption).every((t: any) => t.evotorUuid === null)).toBe(true)
  })

  it('изменение цены добавки уходит в товар (одно место правки)', async () => {
    await adm('POST', '/modifiers', { id: oat, name: 'Овсяное-' + T, price: 55, groupKey: 'milk' })
    expect((db.prepare('SELECT price FROM products WHERE id=?').get(oatProd) as any).price).toBe(55)
    const p = (await catalog()).products.find((x: any) => x.id === raf)
    expect(p.toppings.find((t: any) => t.name === 'Овсяное-' + T).price).toBe(55)
  })

  it('Studio-сохранение схемы поверх явных options не теряется (каталог читает options)', async () => {
    await adm('POST', '/modifier-schemes', { id: scheme, name: 'Кофе-' + T, options: [
      { kind: 'zero', name: 'Обычное', groupKey: 'milk', isDefault: true },
      { kind: 'modifier', modifierId: oat, groupKey: 'milk' }] })
    // Studio снимает «Овсяное» и добавляет «Лаванда»: шлёт только modifierIds
    await adm('POST', '/modifier-schemes', { id: scheme, name: 'Кофе-' + T, modifierIds: [lav] })
    const p = (await catalog()).products.find((x: any) => x.id === raf)
    const names = p.toppings.map((t: any) => t.name)
    expect(names).toContain('Лаванда-' + T)
    expect(names).not.toContain('Овсяное-' + T)
    expect(names).toContain('Обычное') // явный zero сохранён
  })

  it('PWA-меню клиента не показывает «Добавки»', async () => {
    const j = (await (await app.request('/api/directory?storeUuid=' + STORE)).json()) as any
    expect(j.products.map((p: any) => p.id)).not.toContain(oatProd)
    expect(j.categories.map((c: any) => c.name)).not.toContain('Добавки')
  })

  it('товар в категории «Добавки» через API: чашка/бесплатно принудительно 0', async () => {
    const cat = (db.prepare("SELECT id FROM categories WHERE name='Добавки'").get() as any).id
    const r = await adm('POST', '/products', { name: 'Корица2-' + T, price: 10, categoryId: cat, countsAsCup: true, freeEligible: true })
    const row = db.prepare('SELECT counts_as_cup c, free_eligible f FROM products WHERE id=?').get(r.j.id) as any
    expect([row.c, row.f]).toEqual([0, 0])
  })

  it('товар-добавка реально уходит в выгрузку: outbox для точки с sync + фильтр push', async () => {
    const { toEvotorProduct } = await import('../integrations/evotor/sync/ProductPushService')
    const store = 'store-push-' + T
    const cols = db.prepare('PRAGMA table_info(evotor_stores)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'sync_enabled')) {
      db.exec('ALTER TABLE evotor_stores ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 0')
    }
    db.prepare('INSERT INTO evotor_stores(store_uuid,name,sync_enabled,updated_at) VALUES(?,?,1,?)')
      .run(store, 'Точка выгрузки', Date.now())

    const created = await adm('POST', '/modifiers', { name: 'Корица-выгрузка-' + T, price: 25, groupKey: 'syrup', available: true, sortOrder: 0 })
    expect(created.s).toBe(200)
    const productId = created.j.productId as number
    expect(productId).toBeGreaterThan(0)

    // 1) enqueueProductSync поставил задачу именно этой точке (sync_enabled=1)
    const queued = db
      .prepare(`SELECT status FROM evotor_outbox WHERE store_uuid=? AND entity='PRODUCT' AND entity_key=?`)
      .get(store, String(productId)) as { status: string } | undefined
    expect(queued?.status).toBe('PENDING')

    // 2) условие outbound-фильтра ProductPushService.listLocal(false): только catalog_source='SIXTH_CUP'
    const row = db.prepare('SELECT * FROM products WHERE id=?').get(productId) as any
    expect(row.catalog_source).toBe('SIXTH_CUP')
    expect(row.category_id).toBe((db.prepare("SELECT id FROM categories WHERE name='Добавки'").get() as any).id)

    // 3) payload реальной выгрузки несёт стабильный артикул sc-<id>
    const payload = toEvotorProduct(row, store)
    expect(payload.article_number).toBe('sc-' + productId)
    expect(payload.allow_to_sell).toBe(true)
  })

  it('регистр названия категории: «Добавки» с заглавной находится', async () => {
    const { resolveAddonsCategoryId } = await import('../modules/catalog/addonScheme')
    expect(resolveAddonsCategoryId(db)).toBe((db.prepare("SELECT id FROM categories WHERE name='Добавки'").get() as any).id)
  })
})
