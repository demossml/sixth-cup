/**
 * Проксированный endpoint конфигурации карточки:
 * GET /api/devices/products/:productId/configuration?storeUuid=
 *
 * Проверяем авторизацию прокси, объёмы, молоко, добавки, независимость схем,
 * сквозной сценарий с двумя точками и отсутствие утечки UUID между точками.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-pcfg-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'
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
const STORE_A = `cfgA-${T}`
const STORE_B = `cfgB-${T}`
const STORE_C = `cfgC-${T}`

const PROXY = { Authorization: `Bearer proxy-secret` }

async function config_of(productId: number, store: string, headers: Record<string, string> = PROXY) {
  const r = await app.request(
    `/api/devices/products/${productId}/configuration?storeUuid=${encodeURIComponent(store)}`,
    { headers },
  )
  return { s: r.status, j: (await r.json().catch(() => ({}))) as any, cache: r.headers.get('cache-control') }
}

const link = (productId: number, store: string, uuid: string) =>
  db.prepare('INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(productId, store, uuid)

const mkProduct = async (name: string, price = 250) => {
  const r = await adm('POST', '/products', { name: `${name}-${T}`, price, icon: 'Coffee', available: true })
  expect(r.s).toBeLessThan(400)
  return Number(r.j.id)
}

async function mkMilkScheme(paidProductId: number | null, opts: { active?: boolean } = {}) {
  const variants: unknown[] = [
    { label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false, sortOrder: 0, active: true },
  ]
  if (paidProductId != null) {
    variants.push({ label: 'Кокосовое молоко', isDefault: false, isFree: false, sendToReceipt: true, productId: paidProductId, sortOrder: 1, active: true })
  }
  const r = await adm('POST', '/milk-schemes', { name: `Молоко-${T}-${Math.random().toString(36).slice(2, 6)}`, active: opts.active ?? true, variants })
  expect(r.s).toBe(200)
  return Number(r.j.scheme.id)
}

async function mkAddonScheme(syrupProductId: number) {
  const r = await adm('POST', '/modifier-schemes', {
    name: `Сиропы-${T}-${Math.random().toString(36).slice(2, 6)}`,
    options: [
      { kind: 'zero', groupKey: 'syrup', name: 'Без сиропа', isDefault: true, maxCount: 1 },
      { kind: 'product', groupKey: 'syrup', productId: syrupProductId, maxCount: 2 },
    ],
  })
  expect(r.s).toBe(200)
  return Number(r.j.id)
}

beforeAll(() => {
  for (const s of [STORE_A, STORE_B, STORE_C]) {
    db.prepare('INSERT OR IGNORE INTO evotor_stores(store_uuid,name,sync_enabled) VALUES(?,?,1)').run(s, 'Точка')
  }
})

describe('авторизация: APK ходит без токена (как /catalog)', () => {
  it('без Authorization — 200 (APK 5.2.21 не умеет слать токен)', async () => {
    const id = await mkProduct('Без-токена')
    link(id, STORE_A, `u-notoken-${id}`)
    expect((await config_of(id, STORE_A, {})).s).toBe(200)
  })

  it('валидный токен — тоже 200', async () => {
    const id = await mkProduct('Авторизация')
    link(id, STORE_A, `u-auth-${id}`)
    expect((await config_of(id, STORE_A)).s).toBe(200)
  })

  it('передан неверный Authorization — 403', async () => {
    const id = await mkProduct('Авторизация-2')
    const r = await config_of(id, STORE_A, { Authorization: 'Bearer wrong' })
    expect(r.s).toBe(403)
  })

  it('серверный секрет не настроен — маршрут продолжает работать (200), не 5xx', async () => {
    const id = await mkProduct('Авторизация-5')
    link(id, STORE_A, `u-auth5-${id}`)
    const saved = config.evotorProxyToken
    ;(config as any).evotorProxyToken = ''
    try {
      const r = await config_of(id, STORE_A, {})
      expect(r.s).toBe(200)
    } finally {
      ;(config as any).evotorProxyToken = saved
    }
  })
})

describe('валидация запроса', () => {
  it('некорректный productId — 400', async () => {
    const r = await app.request('/api/devices/products/abc/configuration?storeUuid=' + STORE_A, { headers: PROXY })
    expect(r.status).toBe(400)
  })

  it('нет storeUuid — 400', async () => {
    const id = await mkProduct('Без-точки')
    const r = await app.request(`/api/devices/products/${id}/configuration`, { headers: PROXY })
    expect(r.status).toBe(400)
  })

  it('storeUuid из query и заголовка расходятся — берём точку со связями товара (200, не 400)', async () => {
    // APK собирает query из кэша каталога, заголовок — из своей конфигурации;
    // жёсткий 400 ломал продажу, поэтому выбираем точку по фактическим связям.
    const id = await mkProduct('Разные-точки')
    link(id, STORE_A, `u-mismatch-${id}`)
    const r = await config_of(id, STORE_B, { ...PROXY, 'X-Evotor-Store-Uuid': STORE_A })
    expect(r.s).toBe(200)
    // связи есть только у STORE_A → ответ по ней, несмотря на query=STORE_B
    expect(r.j.storeUuid).toBe(STORE_A)
    expect(r.j.volumes[0].evotorUuid).toBe(`u-mismatch-${id}`)
  })

  it('расхождение без связей у обеих точек — 200 и точка из query', async () => {
    const id = await mkProduct('Разные-точки-2')
    const r = await config_of(id, STORE_A, { ...PROXY, 'X-Evotor-Store-Uuid': STORE_B })
    expect(r.s).toBe(200)
    expect(r.j.storeUuid).toBe(STORE_A)
    expect(r.j.volumes[0].available).toBe(false)
  })

  it('короткий номер магазина вместо uuid (прод-кейс query=2026/header=2026…) — 200 и правильные UUID', async () => {
    // Касса присылает номер магазина; в product_store_links лежит полный uuid.
    const short = `9${String(Date.now()).slice(-5)}`
    const full = `${short}1017-AD69-40F0-80D2-3C027B1A4BF8`
    db.prepare('INSERT OR IGNORE INTO evotor_stores(store_uuid,name,sync_enabled) VALUES(?,?,1)').run(full, 'Номерная точка')
    const id = await mkProduct('Номер-магазина')
    link(id, full, `u-short-${id}`)

    const r = await config_of(id, short, { ...PROXY, 'X-Evotor-Store-Uuid': short })
    expect(r.s).toBe(200)
    // клиенту возвращаем то, что он прислал…
    expect(r.j.storeUuid).toBe(short)
    // …но UUID взяты по настоящей точке
    expect(r.j.volumes[0].evotorUuid).toBe(`u-short-${id}`)
    expect(r.j.storeUuidResolved).toBe(full)
  })

  it('storeUuid можно передать только заголовком', async () => {
    const id = await mkProduct('Только-заголовок')
    link(id, STORE_A, `u-hdr-${id}`)
    const r = await app.request(`/api/devices/products/${id}/configuration`, {
      headers: { ...PROXY, 'X-Evotor-Store-Uuid': STORE_A },
    })
    expect(r.status).toBe(200)
  })

  it('несуществующий товар — 200 ok:false (404 зарезервирован за «маршрута нет»)', async () => {
    const r = await config_of(999999, STORE_A)
    expect(r.s).toBe(200)
    expect(r.j).toMatchObject({ ok: false, error: 'product_not_found', productId: 999999, storeUuid: STORE_A })
  })

  it('storeUuid сравнивается без учёта регистра', async () => {
    const id = await mkProduct('Регистр')
    link(id, STORE_A, `u-case-${id}`)
    const r = await config_of(id, STORE_A.toUpperCase(), { ...PROXY, 'X-Evotor-Store-Uuid': STORE_A })
    expect(r.s).toBe(200)
  })

  it('ответ не кешируется', async () => {
    const id = await mkProduct('Кеш')
    link(id, STORE_A, `u-cache-${id}`)
    expect((await config_of(id, STORE_A)).cache).toBe('no-store')
  })
})

describe('объёмы', () => {
  it('один SKU без группы — один вариант', async () => {
    const id = await mkProduct('Один-объём')
    link(id, STORE_A, `u-one-${id}`)
    const r = await config_of(id, STORE_A)
    expect(r.j.volumes).toHaveLength(1)
    expect(r.j.volumes[0]).toMatchObject({ productId: id, evotorUuid: `u-one-${id}`, available: true })
  })

  it('несколько SKU группы — все варианты, каждый со своим UUID точки', async () => {
    const g = await adm('POST', '/product-groups', {
      name: `Латте-${T}`, icon: 'Coffee', sortOrder: 0, countsAsCup: true, freeEligible: true,
      variants: [{ label: '200 мл', price: 220 }, { label: '300 мл', price: 270 }, { label: '400 мл', price: 320 }],
    })
    expect(g.s).toBe(200)
    const rows = ((await adm('GET', '/product-groups')).j.groups as any[]).find((x) => x.id === g.j.id).variants as any[]
    expect(rows).toHaveLength(3)
    for (const v of rows) link(v.id, STORE_A, `u-latteA-${v.id}`)
    for (const v of rows) link(v.id, STORE_B, `u-latteB-${v.id}`)

    const a = await config_of(rows[0].id, STORE_A)
    expect(a.j.volumes.map((v: any) => v.priceRub)).toEqual([220, 270, 320])
    expect(a.j.volumes.map((v: any) => v.evotorUuid)).toEqual(rows.map((v) => `u-latteA-${v.id}`))

    const b = await config_of(rows[0].id, STORE_B)
    expect(b.j.volumes.map((v: any) => v.evotorUuid)).toEqual(rows.map((v) => `u-latteB-${v.id}`))
  })

  it('товар другой группы не попадает в конфигурацию', async () => {
    const g = await adm('POST', '/product-groups', {
      name: `Флэт-${T}`, icon: 'Coffee', sortOrder: 0, variants: [{ label: '250 мл', price: 240 }, { label: '350 мл', price: 290 }],
    })
    const rows = ((await adm('GET', '/product-groups')).j.groups as any[]).find((x) => x.id === g.j.id).variants as any[]
    const stranger = await mkProduct('Чужой-товар')
    link(stranger, STORE_A, `u-stranger-${stranger}`)
    const r = await config_of(rows[0].id, STORE_A)
    expect(r.j.volumes.map((v: any) => v.productId)).not.toContain(stranger)
  })

  it('у точки нет связи — объём недоступен и без чужого UUID', async () => {
    const id = await mkProduct('Без-связи')
    link(id, STORE_A, `u-nolink-${id}`)
    const r = await config_of(id, STORE_C)
    expect(r.j.volumes[0]).toMatchObject({ evotorUuid: null, available: false })
  })
})

describe('молоко', () => {
  it('схема не назначена — milk = null', async () => {
    const id = await mkProduct('Без-молока')
    link(id, STORE_A, `u-nomilk-${id}`)
    expect((await config_of(id, STORE_A)).j.milk).toBeNull()
  })

  it('активная схема — required=true, бесплатное молоко по умолчанию и без чека', async () => {
    const oat = await mkProduct('Овсяное', 60)
    link(oat, STORE_A, `u-oatA-${T}`)
    const scheme = await mkMilkScheme(oat)
    const id = await mkProduct('Капучино-молоко')
    link(id, STORE_A, `u-capp-${id}`)
    await adm('POST', '/products', { id, name: `Капучино-молоко-${T}`, price: 250, milkSchemeId: scheme })

    const r = await config_of(id, STORE_A)
    expect(r.j.milk.required).toBe(true)
    const block = r.j.milk.byProductId[String(id)]
    expect(block.schemeId).toBe(scheme)
    expect(block.options[0]).toMatchObject({ label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false, evotorUuid: null, available: true })
    expect(block.options[1]).toMatchObject({ label: 'Кокосовое молоко', sendToReceipt: true, evotorUuid: `u-oatA-${T}`, available: true })
  })

  it('платное молоко без UUID точки — available=false, без подстановки чужого', async () => {
    const oat = await mkProduct('Овсяное-2', 60)
    link(oat, STORE_A, `u-oatA2-${T}`)
    const scheme = await mkMilkScheme(oat)
    const id = await mkProduct('Капучино-безмолока')
    link(id, STORE_B, `u-cappB-${id}`)
    await adm('POST', '/products', { id, name: `Капучино-безмолока-${T}`, price: 250, milkSchemeId: scheme })

    const b = await config_of(id, STORE_B)
    expect(b.j.milk.byProductId[String(id)].options[1]).toMatchObject({ evotorUuid: null, available: false, notReadyReason: 'no_evotor_uuid' })
  })

  it('неактивная схема не выдаётся как действующая', async () => {
    const scheme = await mkMilkScheme(null, { active: false })
    const id = await mkProduct('Выкл-молоко')
    link(id, STORE_A, `u-offmilk-${id}`)
    await adm('POST', '/products', { id, name: `Выкл-молоко-${T}`, price: 250, milkSchemeId: scheme })
    const r = await config_of(id, STORE_A)
    // Схема назначена, но вариантов нет: это ошибка конфигурации, а не «молока нет».
    expect(r.j.milk.required).toBe(true)
    expect(r.j.milk.byProductId[String(id)].error).toBe('empty_scheme')
    expect(r.j.configErrors.map((e: any) => e.code)).toContain('milk_scheme_empty')
  })

  it('у разных объёмов разные назначения схемы молока', async () => {
    const oat = await mkProduct('Овсяное-3', 60)
    link(oat, STORE_A, `u-oatA3-${T}`)
    const scheme = await mkMilkScheme(oat)
    const g = await adm('POST', '/product-groups', {
      name: `Раф-${T}`, icon: 'Coffee', sortOrder: 0, variants: [{ label: '300 мл', price: 280 }, { label: '400 мл', price: 330 }],
    })
    const rows = ((await adm('GET', '/product-groups')).j.groups as any[]).find((x) => x.id === g.j.id).variants as any[]
    for (const v of rows) link(v.id, STORE_A, `u-raf-${v.id}`)
    await adm('POST', '/products', { id: rows[0].id, name: rows[0].name, price: 280, milkSchemeId: scheme })

    const r = await config_of(rows[0].id, STORE_A)
    expect(r.j.milk.byProductId[String(rows[0].id)].schemeId).toBe(scheme)
    // у второго объёма схема не назначена: ключ есть, options пустые
    expect(r.j.milk.byProductId[String(rows[1].id)]).toEqual({ schemeId: null, options: [] })
  })
})

describe('добавки', () => {
  it('схема не назначена — additions = null', async () => {
    const id = await mkProduct('Без-добавок')
    link(id, STORE_A, `u-noadd-${id}`)
    expect((await config_of(id, STORE_A)).j.additions).toBeNull()
  })

  it('схема назначена — варианты, required=false, без молочных позиций', async () => {
    const syrup = await mkProduct('Сироп', 40)
    link(syrup, STORE_A, `u-syrupA-${T}`)
    const scheme = await mkAddonScheme(syrup)
    const id = await mkProduct('Капучино-добавки')
    link(id, STORE_A, `u-add-${id}`)
    await adm('POST', '/products', { id, name: `Капучино-добавки-${T}`, price: 250, modifierSchemeId: scheme })

    const r = await config_of(id, STORE_A)
    expect(r.j.additions.required).toBe(false)
    const block = r.j.additions.byProductId[String(id)]
    expect(block.schemeId).toBe(scheme)
    expect(block.options.every((o: any) => o.required === false)).toBe(true)
    expect(block.options.some((o: any) => o.groupKey === 'milk')).toBe(false)
    expect(block.options.map((o: any) => o.groupKey)).toEqual(['syrup', 'syrup'])
    expect(block.options.find((o: any) => !o.zeroOption)).toMatchObject({ evotorUuid: `u-syrupA-${T}`, priceRub: 40, maxCount: 2, sendToReceipt: true })
  })

  it('нет UUID у платной добавки — available=false, zero остаётся доступным', async () => {
    const syrup = await mkProduct('Сироп-без-uuid', 40)
    const scheme = await mkAddonScheme(syrup)
    const id = await mkProduct('Капучино-без-uuid')
    link(id, STORE_A, `u-add2-${id}`)
    await adm('POST', '/products', { id, name: `Капучино-без-uuid-${T}`, price: 250, modifierSchemeId: scheme })

    const block = (await config_of(id, STORE_A)).j.additions.byProductId[String(id)]
    const paid = block.options.find((o: any) => !o.zeroOption)
    expect(paid).toMatchObject({ evotorUuid: null, available: false })
    const zero = block.options.find((o: any) => o.zeroOption)
    expect(zero).toMatchObject({ available: true, evotorUuid: null, sendToReceipt: false })
  })

  it('UUID соседней точки не подставляется', async () => {
    const syrup = await mkProduct('Сироп-чужой', 40)
    link(syrup, STORE_B, `u-syrupB-${T}`)
    const scheme = await mkAddonScheme(syrup)
    const id = await mkProduct('Капучино-чужая-точка')
    link(id, STORE_A, `u-add3-${id}`)
    await adm('POST', '/products', { id, name: `Капучино-чужая-точка-${T}`, price: 250, modifierSchemeId: scheme })

    const block = (await config_of(id, STORE_A)).j.additions.byProductId[String(id)]
    expect(block.options.find((o: any) => !o.zeroOption).evotorUuid).toBeNull()
  })
})

describe('независимость схем', () => {
  it('назначение добавок не создаёт молоко', async () => {
    const syrup = await mkProduct('Сироп-нез', 40)
    link(syrup, STORE_A, `u-syrupN-${T}`)
    const scheme = await mkAddonScheme(syrup)
    const id = await mkProduct('Только-добавки')
    link(id, STORE_A, `u-onlyadd-${id}`)
    await adm('POST', '/products', { id, name: `Только-добавки-${T}`, price: 250, modifierSchemeId: scheme })

    const r = await config_of(id, STORE_A)
    expect(r.j.milk).toBeNull()
    expect(r.j.additions.byProductId[String(id)].options.some((o: any) => o.groupKey === 'milk')).toBe(false)
  })

  it('снятие молока не трогает добавки, снятие добавок не трогает молоко', async () => {
    const oat = await mkProduct('Овсяное-нез', 60)
    link(oat, STORE_A, `u-oatN-${T}`)
    const milk = await mkMilkScheme(oat)
    const syrup = await mkProduct('Сироп-нез2', 40)
    link(syrup, STORE_A, `u-syrupN2-${T}`)
    const addons = await mkAddonScheme(syrup)
    const id = await mkProduct('Обе-схемы-нез')
    link(id, STORE_A, `u-bothN-${id}`)
    await adm('POST', '/products', { id, name: `Обе-схемы-нез-${T}`, price: 250, milkSchemeId: milk, modifierSchemeId: addons })

    await adm('POST', '/products', { id, name: `Обе-схемы-нез-${T}`, price: 250, milkSchemeId: null })
    let r = await config_of(id, STORE_A)
    expect(r.j.milk).toBeNull()
    expect(r.j.additions).not.toBeNull()

    await adm('POST', '/products', { id, name: `Обе-схемы-нез-${T}`, price: 250, modifierSchemeId: null })
    r = await config_of(id, STORE_A)
    expect(r.j.additions).toBeNull()
    expect(r.j.milk).toBeNull()
  })

  it('сохранение товара без поля молока не обнуляет назначение', async () => {
    const oat = await mkProduct('Овсяное-save', 60)
    link(oat, STORE_A, `u-oatS-${T}`)
    const milk = await mkMilkScheme(oat)
    const id = await mkProduct('Сохранение-схемы')
    link(id, STORE_A, `u-save-${id}`)
    await adm('POST', '/products', { id, name: `Сохранение-схемы-${T}`, price: 250, milkSchemeId: milk })
    // Тело без milkSchemeId — «не трогать»
    await adm('POST', '/products', { id, name: `Сохранение-схемы-${T}`, price: 260 })
    const r = await config_of(id, STORE_A)
    expect(r.j.milk.byProductId[String(id)].schemeId).toBe(milk)
  })
})

describe('сквозной сценарий: админка → схема → прокси → JSON', () => {
  it('две точки получают свои UUID, третья — ни одного', async () => {
    const oat = await mkProduct('Сквозное-молоко', 60)
    const syrup = await mkProduct('Сквозной-сироп', 40)
    for (const [store, tag] of [[STORE_A, 'A'], [STORE_B, 'B']] as const) {
      link(oat, store, `u-oat${tag}-${T}`)
      link(syrup, store, `u-syrup${tag}-${T}`)
    }
    const milk = await mkMilkScheme(oat)
    const addons = await mkAddonScheme(syrup)

    const g = await adm('POST', '/product-groups', {
      name: `Сквозной-${T}`, icon: 'Coffee', sortOrder: 0, countsAsCup: true, freeEligible: true,
      variants: [{ label: '200 мл', price: 220 }, { label: '300 мл', price: 270 }, { label: '400 мл', price: 320 }],
    })
    const rows = ((await adm('GET', '/product-groups')).j.groups as any[]).find((x) => x.id === g.j.id).variants as any[]
    for (const v of rows) {
      for (const [store, tag] of [[STORE_A, 'A'], [STORE_B, 'B']] as const) link(v.id, store, `u-cfg${tag}-${v.id}`)
      await adm('POST', '/products', { id: v.id, name: v.name, price: v.price, milkSchemeId: milk, modifierSchemeId: addons })
    }

    const a = await config_of(rows[0].id, STORE_A)
    const b = await config_of(rows[0].id, STORE_B)
    const c = await config_of(rows[0].id, STORE_C)

    expect(a.j.volumes.map((v: any) => v.evotorUuid)).toEqual(rows.map((v) => `u-cfgA-${v.id}`))
    expect(b.j.volumes.map((v: any) => v.evotorUuid)).toEqual(rows.map((v) => `u-cfgB-${v.id}`))
    expect(c.j.volumes.every((v: any) => v.evotorUuid === null && v.available === false)).toBe(true)

    // каждый объём имеет свою конфигурацию
    for (const v of rows) {
      expect(a.j.milk.byProductId[String(v.id)].schemeId).toBe(milk)
      expect(a.j.additions.byProductId[String(v.id)].schemeId).toBe(addons)
    }
    // бесплатное молоко не уходит в чек
    const free = a.j.milk.byProductId[String(rows[0].id)].options.find((o: any) => o.isFree)
    expect(free.sendToReceipt).toBe(false)
    // молоко и добавки не смешиваются
    expect(a.j.milk.byProductId[String(rows[0].id)].options.some((o: any) => o.groupKey)).toBe(false)
    expect(a.j.additions.byProductId[String(rows[0].id)].options.some((o: any) => o.label === 'Обычное молоко')).toBe(false)
    // платные позиции получают UUID своей точки
    expect(a.j.milk.byProductId[String(rows[0].id)].options.find((o: any) => o.sendToReceipt).evotorUuid).toBe(`u-oatA-${T}`)
    expect(b.j.additions.byProductId[String(rows[0].id)].options.find((o: any) => !o.zeroOption).evotorUuid).toBe(`u-syrupB-${T}`)
    // третья точка: платные позиции недоступны
    expect(c.j.milk.byProductId[String(rows[0].id)].options.find((o: any) => o.sendToReceipt).available).toBe(false)
  })
})
