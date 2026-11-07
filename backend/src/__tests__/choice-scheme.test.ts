/**
 * Схема выбора без цены («с корицей» / «без корицы»): отдельная сущность.
 * CRUD, правила валидации, назначение (в т.ч. массовое с предпросмотром), выдача в каталог
 * и в /configuration (аддитивный ключ `choices`, schemaVersion остаётся 1), readiness, права.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-choice-'))
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
const configuration = async (pid: number, store: string) =>
  (await (await app.request(`/api/devices/products/${pid}/configuration?storeUuid=${encodeURIComponent(store)}`)).json()) as any

const T = Date.now()
const STORE = `store-choice-${T}`

const link = (id: number, uuid: string) =>
  db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(id, STORE, uuid)

async function mkProduct(name: string, price = 250): Promise<number> {
  const r = await adm('POST', '/products', { name: `${name}-${T}`, price, icon: 'Coffee', available: true })
  expect(r.s).toBe(200)
  return Number(r.j.id)
}

const cinnamon = (over: Record<string, unknown> = {}) => ({
  name: `Корица-${T}-${Math.random().toString(36).slice(2, 6)}`,
  title: 'Корица',
  active: true,
  options: [
    { label: 'С корицей', isDefault: false, sortOrder: 0, active: true },
    { label: 'Без корицы', isDefault: false, sortOrder: 1, active: true },
  ],
  ...over,
})

async function mkScheme(over: Record<string, unknown> = {}) {
  const r = await adm('POST', '/choice-schemes', cinnamon(over))
  expect(r.s).toBe(200)
  return r.j.scheme as { id: number; title: string; options: { id: number; label: string; isDefault: boolean }[] }
}

async function assign(productId: number, schemeId: number | null) {
  const r = await adm('POST', '/products', {
    id: productId, name: `x-${productId}`, price: 250, icon: 'Coffee', available: true, choiceSchemeId: schemeId,
  })
  expect(r.s).toBe(200)
}

beforeEach(() => {
  db.prepare('INSERT OR IGNORE INTO evotor_stores(store_uuid,name,sync_enabled) VALUES(?,?,1)').run(STORE, 'Точка')
})

describe('CRUD и валидация', () => {
  it('создаёт схему и отдаёт её в списке с числом назначений', async () => {
    const s = await mkScheme()
    expect(s.options).toHaveLength(2)
    const list = (await adm('GET', '/choice-schemes')).j.schemes as any[]
    const found = list.find((x) => x.id === s.id)
    expect(found.title).toBe('Корица')
    expect(found.usedByProducts).toBe(0)
  })

  it('одна активная опция → 400', async () => {
    const r = await adm('POST', '/choice-schemes', cinnamon({ options: [{ label: 'Только одна', isDefault: false, sortOrder: 0, active: true }] }))
    expect(r.s).toBe(400)
    expect(String(r.j.error)).toMatch(/минимум два/i)
  })

  it('неактивная вторая опция не считается', async () => {
    const r = await adm('POST', '/choice-schemes', cinnamon({
      options: [
        { label: 'С корицей', isDefault: false, sortOrder: 0, active: true },
        { label: 'Без корицы', isDefault: false, sortOrder: 1, active: false },
      ],
    }))
    expect(r.s).toBe(400)
  })

  it('дубль подписи (без учёта регистра) → 400', async () => {
    const r = await adm('POST', '/choice-schemes', cinnamon({
      options: [
        { label: 'С корицей', isDefault: false, sortOrder: 0, active: true },
        { label: 'с корицей', isDefault: false, sortOrder: 1, active: true },
      ],
    }))
    expect(r.s).toBe(400)
    expect(String(r.j.error)).toMatch(/повторяется/i)
  })

  it('две опции по умолчанию → 400', async () => {
    const r = await adm('POST', '/choice-schemes', cinnamon({
      options: [
        { label: 'С корицей', isDefault: true, sortOrder: 0, active: true },
        { label: 'Без корицы', isDefault: true, sortOrder: 1, active: true },
      ],
    }))
    expect(r.s).toBe(400)
  })

  it('подпись длиннее 24 символов отклоняется', async () => {
    const r = await adm('POST', '/choice-schemes', cinnamon({
      options: [
        { label: 'С корицей', isDefault: false, sortOrder: 0, active: true },
        { label: 'Очень-очень длинная подпись варианта', isDefault: false, sortOrder: 1, active: true },
      ],
    }))
    expect(r.s).toBeGreaterThanOrEqual(400)
  })

  it('обновление заменяет варианты целиком', async () => {
    const s = await mkScheme()
    const r = await adm('POST', '/choice-schemes', {
      id: s.id, name: 'Корица v2', title: 'Корица', active: true,
      options: [
        { label: 'С корицей', isDefault: true, sortOrder: 0, active: true },
        { label: 'Без корицы', isDefault: false, sortOrder: 1, active: true },
        { label: 'Много корицы', isDefault: false, sortOrder: 2, active: true },
      ],
    })
    expect(r.s).toBe(200)
    expect(r.j.scheme.options).toHaveLength(3)
    expect(r.j.scheme.options[0].isDefault).toBe(true)
  })

  it('удаление назначенной схемы запрещено, свободной — разрешено', async () => {
    const s = await mkScheme()
    const p = await mkProduct('Капучино-del')
    await assign(p, s.id)
    expect((await adm('DELETE', `/choice-schemes/${s.id}`)).s).toBe(409)
    await assign(p, null)
    expect((await adm('DELETE', `/choice-schemes/${s.id}`)).s).toBe(200)
  })

  it('manager (marketer-токен) получает 403 на запись', async () => {
    const r = await app.request('/api/admin/choice-schemes', {
      method: 'POST',
      headers: { 'X-Admin-Token': 'mgr-token', 'content-type': 'application/json' },
      body: JSON.stringify(cinnamon()),
    })
    expect(r.status).toBe(403)
  })
})

describe('назначение и каталог кассы', () => {
  it('назначение и снятие у товара; каталог отдаёт choiceSchemeId', async () => {
    const s = await mkScheme()
    const p = await mkProduct('Капучино-cat')
    link(p, `u-cat-${p}`)
    await assign(p, s.id)
    let item = (await catalog(STORE)).products.find((x: any) => x.id === p)
    expect(item.choiceSchemeId).toBe(s.id)
    expect(item.config.choices).toBeUndefined() // блок кассе отдаёт только /configuration; каталог — лишь признак назначения
    await assign(p, null)
    item = (await catalog(STORE)).products.find((x: any) => x.id === p)
    expect(item.choiceSchemeId).toBeNull()
  })

  it('товар без назначения не получает блок; «не трогать» сохраняет назначение', async () => {
    const s = await mkScheme()
    const p = await mkProduct('Капучино-keep')
    await assign(p, s.id)
    // повторное сохранение товара без поля choiceSchemeId не снимает назначение
    const r = await adm('POST', '/products', { id: p, name: `y-${p}`, price: 260, icon: 'Coffee', available: true })
    expect(r.s).toBe(200)
    const row = db.prepare('SELECT choice_scheme_id AS c FROM products WHERE id=?').get(p) as { c: number }
    expect(row.c).toBe(s.id)
  })

  it('неактивная схема не отдаётся кассе (choiceSchemeId = null)', async () => {
    const s = await mkScheme()
    const p = await mkProduct('Капучино-off')
    link(p, `u-off-${p}`)
    await assign(p, s.id)
    await adm('POST', '/choice-schemes', { id: s.id, name: 'off', title: 'Корица', active: false, options: s.options.map((o, i) => ({ label: o.label, isDefault: false, sortOrder: i, active: true })) })
    const item = (await catalog(STORE)).products.find((x: any) => x.id === p)
    expect(item.choiceSchemeId).toBeNull()
    const cfg = await configuration(p, STORE)
    expect(cfg.choices).toBeNull()
  })

  it('массовое назначение группе: dryRun ничего не пишет, затем применяется ко всем размерам', async () => {
    const s = await mkScheme()
    const g = await adm('POST', '/product-groups', {
      name: `Капучино-grp-${T}`, icon: 'Coffee', sortOrder: 0, countsAsCup: true, freeEligible: true,
      variants: [{ label: '250 мл', price: 200 }, { label: '350 мл', price: 250 }, { label: '400 мл', price: 300 }],
    })
    expect(g.s).toBe(200)
    const gid = g.j.id as number
    const dry = await adm('POST', '/choice-schemes/apply', { schemeId: s.id, groupIds: [gid], dryRun: true })
    expect(dry.s).toBe(200)
    expect(dry.j.items).toHaveLength(3)
    expect(dry.j.changed).toBe(3)
    const before = db.prepare('SELECT COUNT(*) AS n FROM products WHERE group_id=? AND choice_scheme_id IS NOT NULL').get(gid) as { n: number }
    expect(before.n).toBe(0)
    const real = await adm('POST', '/choice-schemes/apply', { schemeId: s.id, groupIds: [gid], dryRun: false })
    expect(real.j.changed).toBe(3)
    const after = db.prepare('SELECT COUNT(*) AS n FROM products WHERE group_id=? AND choice_scheme_id=?').get(gid, s.id) as { n: number }
    expect(after.n).toBe(3)
    // повтор — ничего не меняется
    expect((await adm('POST', '/choice-schemes/apply', { schemeId: s.id, groupIds: [gid] })).j.changed).toBe(0)
    // снятие
    expect((await adm('POST', '/choice-schemes/apply', { schemeId: null, groupIds: [gid] })).j.changed).toBe(3)
  })

  it('apply: пустой список целей → 400, несуществующая схема → 400', async () => {
    expect((await adm('POST', '/choice-schemes/apply', { schemeId: 1 })).s).toBe(400)
    expect((await adm('POST', '/choice-schemes/apply', { schemeId: 999999, productIds: [1] })).s).toBe(400)
  })
})

describe('GET /configuration: аддитивный ключ choices', () => {
  it('эспрессо без схемы: choices = null, schemaVersion = 1', async () => {
    const p = await mkProduct('Эспрессо-cfg', 150)
    link(p, `u-esp-${p}`)
    const cfg = await configuration(p, STORE)
    expect(cfg.ok).toBe(true)
    expect(cfg.schemaVersion).toBe(1)
    expect(cfg.choices).toBeNull()
  })

  it('капучино со схемой: по SKU две опции в порядке, без uuid/цен и без null-значений; молоко не затронуто', async () => {
    const s = await mkScheme({
      options: [
        { label: 'С корицей', isDefault: false, sortOrder: 0, active: true },
        { label: 'Без корицы', isDefault: true, sortOrder: 1, active: true },
      ],
    })
    const g = await adm('POST', '/product-groups', {
      name: `Капучино-cfg-${T}`, icon: 'Coffee', sortOrder: 0, countsAsCup: true, freeEligible: true, choiceSchemeId: s.id,
      variants: [{ label: '250 мл', price: 200 }, { label: '350 мл', price: 250 }],
    })
    expect(g.s).toBe(200)
    const skus = db.prepare('SELECT id FROM products WHERE group_id=? ORDER BY variant_sort, id').all(g.j.id) as { id: number }[]
    skus.forEach((x) => link(x.id, `u-cap-${x.id}`))
    const cfg = await configuration(skus[0].id, STORE)
    expect(cfg.schemaVersion).toBe(1)
    expect(cfg.choices.required).toBe(true)
    for (const sku of skus) {
      const block = cfg.choices.byProductId[String(sku.id)]
      expect(block.schemeId).toBe(s.id)
      expect(block.title).toBe('Корица')
      expect(block.options.map((o: any) => o.label)).toEqual(['С корицей', 'Без корицы'])
      expect(block.options.map((o: any) => o.isDefault)).toEqual([false, true])
      expect(Object.keys(block.options[0]).sort()).toEqual(['id', 'isDefault', 'label'])
    }
    expect(JSON.stringify(cfg.choices)).not.toContain('null,')
    expect(cfg.milk).toBeNull() // молоко не назначали — формат прежний
    expect(cfg.configErrors).not.toContain('choice_scheme_invalid')
  })

  it('SKU без назначения в группе получает пустой блок (касса его не рисует)', async () => {
    const s = await mkScheme()
    const g = await adm('POST', '/product-groups', {
      name: `Латте-mix-${T}`, icon: 'Coffee', sortOrder: 0, countsAsCup: true, freeEligible: true,
      variants: [{ label: '250 мл', price: 200 }, { label: '350 мл', price: 250 }],
    })
    const skus = db.prepare('SELECT id FROM products WHERE group_id=? ORDER BY variant_sort, id').all(g.j.id) as { id: number }[]
    skus.forEach((x) => link(x.id, `u-mix-${x.id}`))
    await assign(skus[0].id, s.id)
    const cfg = await configuration(skus[0].id, STORE)
    expect(cfg.choices.byProductId[String(skus[0].id)].options).toHaveLength(2)
    expect(cfg.choices.byProductId[String(skus[1].id)]).toEqual({ schemeId: null, title: '', options: [] })
  })

  it('схема активна, но активных вариантов < 2 (правка в БД) → error + configErrors + readiness', async () => {
    const s = await mkScheme()
    const p = await mkProduct('Капучино-bad')
    link(p, `u-bad-${p}`)
    await assign(p, s.id)
    db.prepare('UPDATE choice_scheme_options SET active=0 WHERE scheme_id=? AND id=(SELECT MAX(id) FROM choice_scheme_options WHERE scheme_id=?)').run(s.id, s.id)
    const cfg = await configuration(p, STORE)
    expect(cfg.choices.byProductId[String(p)].error).toBe('invalid_scheme')
    expect(cfg.configErrors).toContain('choice_scheme_invalid')
    const ready = (await adm('GET', `/catalog/readiness?storeUuid=${encodeURIComponent(STORE)}`))
    const entries = (ready.j.notReady ?? ready.j.readiness?.notReady ?? []) as any[]
    expect(entries.some((e) => e.kind === 'choice' && e.reason === 'choice_scheme_empty' && e.productId === p)).toBe(true)
  })

  it('формат молока и объёмов не изменился (регрессия)', async () => {
    const paid = await mkProduct('Молоко кокосовое-chk', 80)
    link(paid, `u-coco-${paid}`)
    const m = await adm('POST', '/milk-schemes', {
      name: `М-${T}`, active: true,
      variants: [
        { label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false, sortOrder: 0, active: true },
        { label: 'Кокосовое молоко', isDefault: false, isFree: false, sendToReceipt: true, productId: paid, sortOrder: 1, active: true },
      ],
    })
    expect(m.s).toBe(200)
    const s = await mkScheme()
    const drink = await mkProduct('Капучино-reg')
    link(drink, `u-reg-${drink}`)
    await adm('POST', '/products', { id: drink, name: `r-${drink}`, price: 250, icon: 'Coffee', available: true, milkSchemeId: m.j.scheme.id, choiceSchemeId: s.id })
    const cfg = await configuration(drink, STORE)
    const milk = cfg.milk.byProductId[String(drink)].options as any[]
    expect(milk.find((o) => o.label === 'Кокосовое молоко').evotorUuid).toBe(`u-coco-${paid}`)
    expect(cfg.choices.byProductId[String(drink)].options).toHaveLength(2)
    // id молока и id выбора — разные пространства: выбор не содержит uuid/цен молока
    expect(JSON.stringify(cfg.choices)).not.toContain('evotorUuid')
  })
})
