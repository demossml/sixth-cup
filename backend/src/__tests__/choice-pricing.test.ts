/**
 * PWA-аудит 15.11.2026, дефект P0: обязательный выбор («с корицей») тарифицировался как сироп.
 *
 * Симптом живого клиента: «С корицей» → +40 ₽ (Сироп ваниль), «Без корицы» → +50 ₽,
 * 250 + 350 мл → 490 ₽ вместо 410 ₽. Причина: выбор ехал в `modifiers` без `groupKey`,
 * и резолвер искал его id среди платных добавок.
 *
 * Контракт после фикса:
 *  - выбор приходит отдельным полем `choices: [{ schemeId?, optionId }]` и стоит 0 ₽;
 *  - старый клиент (id выбора в `modifiers` без `groupKey`) не тарифицируется, а считается выбором;
 *  - неизвестный id по-прежнему 400 — «тихо игнорировать» нельзя.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-choice-pricing-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { config } = await import('../config')
const { db } = await import('../db')

const H_ADMIN = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const JSONH = { 'content-type': 'application/json' }

const T = Date.now()
const STORE = 11
const SKU = 6010
const VANILLA = 8001
const VANILLA_PRODUCT = 8010

let guest = { token: '', userId: 0 }
let choiceOptions: { id: number; label: string }[] = []
let syrupOptionId = ''

async function mkGuest() {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: JSONH, body: '{}' })
  const { token } = (await r.json()) as { token: string }
  const me = await app.request('/api/loyalty/card', { headers: { Authorization: 'Bearer ' + token } })
  const j = (await me.json()) as { cardCode?: string }
  const row = db.prepare('SELECT id FROM users WHERE card_code=?').get(String(j.cardCode)) as { id: number }
  return { token, userId: Number(row.id) }
}

const quote = async (items: unknown[]) => {
  const r = await app.request('/api/orders/quote', {
    method: 'POST',
    headers: { ...JSONH, Authorization: 'Bearer ' + guest.token },
    body: JSON.stringify({ storeId: STORE, items, benefit: null }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, any> }
}

const createOrder = async (items: unknown[], quoteToken?: string) => {
  const r = await app.request('/api/orders', {
    method: 'POST',
    headers: { ...JSONH, Authorization: 'Bearer ' + guest.token },
    body: JSON.stringify({ storeId: STORE, items, quoteToken: quoteToken ?? null }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, any> }
}

beforeEach(async () => {
  const t = Date.now()
  db.prepare(`INSERT OR REPLACE INTO stores(id,name,address) VALUES(?,?,?)`).run(STORE, 'Покровка', 'Покровка 12')
  db.prepare(`INSERT OR REPLACE INTO evotor_stores(store_uuid,name,local_store_id,updated_at)
    VALUES('ev-store-choice-pricing','Покровка',?,?)`).run(STORE, t)
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,available,icon,counts_as_cup,sort_order,created_at,updated_at)
    VALUES(?,?,?,1,'Coffee',1,1,?,?)`).run(SKU, 'Капучино', 250, t, t)
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,available,icon,sort_order,created_at,updated_at)
    VALUES(?,?,?,1,'Milk',2,?,?)`).run(VANILLA_PRODUCT, 'Сироп ваниль', 40, t, t)
  db.prepare(`INSERT OR REPLACE INTO modifiers(id,name,price,group_key,available,linked_product_id,sort_order,created_at,updated_at)
    VALUES(?,?,?,?,1,?,0,?,?)`).run(VANILLA, 'Ваниль', 40, 'syrup', VANILLA_PRODUCT, t, t)

  const scheme = await app.request('/api/admin/modifier-schemes', {
    method: 'POST',
    headers: H_ADMIN,
    body: JSON.stringify({
      name: `Схема-${T}`,
      options: [{ kind: 'modifier', modifierId: VANILLA, groupKey: 'syrup', maxCount: 2, required: false }],
    }),
  })
  const schemeJson = (await scheme.json()) as any
  const schemeId = Number(schemeJson.id ?? schemeJson.scheme?.id)
  db.prepare('UPDATE products SET modifier_scheme_id=? WHERE id=?').run(schemeId, SKU)
  const syrupRow = db
    .prepare('SELECT id FROM modifier_scheme_options WHERE scheme_id=? ORDER BY id LIMIT 1')
    .get(schemeId) as { id: number } | undefined
  syrupOptionId = String(syrupRow?.id ?? '')

  const choice = await app.request('/api/admin/choice-schemes', {
    method: 'POST',
    headers: H_ADMIN,
    body: JSON.stringify({
      name: `Корица-${T}`,
      title: 'Корица',
      active: true,
      options: [
        { label: 'С корицей', isDefault: false, sortOrder: 0, active: true },
        { label: 'Без корицы', isDefault: false, sortOrder: 1, active: true },
      ],
    }),
  })
  const created = (await choice.json()) as any
  const choiceScheme = created.scheme ?? created
  expect(choiceScheme.id).toBeTruthy()
  choiceOptions = (choiceScheme.options as { id: number; label: string }[]).map((o) => ({ id: o.id, label: o.label }))
  db.prepare('UPDATE products SET choice_scheme_id=? WHERE id=?').run(Number(choiceScheme.id), SKU)

  guest = await mkGuest()
})

describe('Обязательный выбор не тарифицируется', () => {
  it('choices: стоимость позиции равна цене SKU', async () => {
    const r = await quote([{ productId: String(SKU), quantity: 1, choices: [{ optionId: String(choiceOptions[0].id) }] }])
    expect(r.status).toBe(200)
    expect(r.body.subtotal).toBe(250)
    expect(r.body.items[0].unitPriceEstimate).toBe(250)
  })

  it('оба варианта выбора одинаковы по цене: нет «с корицей +40 / без +50»', async () => {
    const withCinnamon = await quote([
      { productId: String(SKU), quantity: 1, choices: [{ optionId: String(choiceOptions[0].id) }] },
    ])
    const withoutCinnamon = await quote([
      { productId: String(SKU), quantity: 1, choices: [{ optionId: String(choiceOptions[1].id) }] },
    ])
    expect(withCinnamon.body.subtotal).toBe(250)
    expect(withoutCinnamon.body.subtotal).toBe(250)
  })

  it('старый клиент (id выбора в modifiers без groupKey) не получает наценку', async () => {
    const r = await quote([
      { productId: String(SKU), quantity: 1, modifiers: [{ modifierId: String(choiceOptions[0].id) }] },
    ])
    expect(r.status).toBe(200)
    expect(r.body.subtotal).toBe(250)
  })

  it('выбор + платный сироп: платим только за сироп', async () => {
    const r = await quote([
      {
        productId: String(SKU),
        quantity: 1,
        modifiers: [{ modifierId: syrupOptionId, groupKey: 'syrup' }],
        choices: [{ optionId: String(choiceOptions[0].id) }],
      },
    ])
    expect(r.status).toBe(200)
    expect(r.body.subtotal).toBe(290)
  })

  it('количество: 3 × капучино с выбором = 750 ₽', async () => {
    const r = await quote([
      { productId: String(SKU), quantity: 3, choices: [{ optionId: String(choiceOptions[1].id) }] },
    ])
    expect(r.body.subtotal).toBe(750)
  })

  it('неизвестный id выбора отклоняется, а не игнорируется', async () => {
    const r = await quote([{ productId: String(SKU), quantity: 1, choices: [{ optionId: '999999' }] }])
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('choice_not_allowed')
  })

  it('коллизия id: опция выбора и сироп с одним id — без groupKey деньги не берём', async () => {
    // На проде «С корицей» и «Сироп ваниль» получили одинаковый optionId — разные таблицы
    // опций нумеруются независимо. Воспроизводим ровно это: добавляем в схему добавок
    // опцию с id, который уже занят вариантом выбора.
    const colliding = Number(choiceOptions[0].id)
    const schemeId = Number(
      (db.prepare('SELECT modifier_scheme_id AS id FROM products WHERE id=?').get(SKU) as { id: number }).id,
    )
    db.prepare(
      `INSERT INTO modifier_scheme_options(id, scheme_id, kind, modifier_id, name, group_key, is_default, required, max_count, sort_order)
       VALUES(?,?,?,?,?,?,0,0,2,99)`,
    ).run(colliding, schemeId, 'modifier', VANILLA, 'Ваниль-collide', 'syrup')
    expect(db.prepare('SELECT id FROM modifier_scheme_options WHERE id=?').get(colliding)).toBeTruthy()

    const free = await quote([
      { productId: String(SKU), quantity: 1, modifiers: [{ modifierId: String(colliding) }] },
    ])
    expect(free.status).toBe(200)
    expect(free.body.subtotal).toBe(250)

    // С явным groupKey тот же id — уже платный сироп.
    const paid = await quote([
      { productId: String(SKU), quantity: 1, modifiers: [{ modifierId: String(colliding), groupKey: 'syrup' }] },
    ])
    expect(paid.body.subtotal).toBe(290)
  })

  it('заказ принимается с той же суммой, что и quote (без расхождения)', async () => {
    const items = [{ productId: String(SKU), quantity: 1, choices: [{ optionId: String(choiceOptions[0].id) }] }]
    const q = await quote(items)
    expect(q.body.subtotal).toBe(250)
    // Сервер сам сверяет сумму с подписанным quote и вернул бы quote_stale при расхождении.
    const order = await createOrder(items, q.body.quoteToken)
    expect(order.status).toBe(200)
    expect(order.body.ok).toBe(true)
    expect(order.body.order?.id).toBeTruthy()
  })
})
