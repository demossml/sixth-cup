/**
 * Бонус гостя в предзаказе: quote (подарок / ваучер / кэшбэк), приём в заказе,
 * резерв лояльности и его освобождение при отмене.
 *
 * Проверяем только новую механику. Старые сценарии (ETA, бан, статусы) — в preorder-lifecycle.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-benefit-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { config } = await import('../config')
const { ensureCard } = await import('../modules/loyalty/proof')

const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const JSONH = { 'content-type': 'application/json' }

const STORE = 1
const CUP = 950 // чашка, участвует в подарке
const FOOD = 951 // еда, подарок не даёт
let seq = 0
const uniq = (p: string) => `${p}-${++seq}`

type Guest = { token: string; userId: number; code: string }

async function guest(): Promise<Guest> {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: JSONH, body: '{}' })
  const { token } = (await r.json()) as { token: string }
  const me = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  const j = (await me.json()) as { cardCode?: string }
  const row = db.prepare('SELECT id FROM users WHERE card_code=?').get(String(j.cardCode)) as { id: number }
  ensureCard(row.id)
  return { token, userId: Number(row.id), code: String(j.cardCode) }
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

const quote = async (
  g: Guest,
  items: Array<{ productId: string; quantity: number; modifiers?: Array<{ modifierId: string }> }>,
  benefit: unknown = null,
) => {
  const r = await app.request('/api/orders/quote', {
    method: 'POST',
    headers: { ...JSONH, ...auth(g.token) },
    body: JSON.stringify({ storeId: STORE, items, benefit }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, any> }
}

const createOrder = async (g: Guest, items: Array<{ productId: string; quantity: number }>, quoteToken?: string) => {
  const r = await app.request('/api/orders', {
    method: 'POST',
    headers: { ...JSONH, ...auth(g.token) },
    body: JSON.stringify({ storeId: STORE, items, quoteToken }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, any> }
}

/** Гость с правом на подарок: paid_total = cupsForFree. */
function makeGiftEligible(userId: number) {
  db.prepare('UPDATE cards SET paid_total=?, free_used=0 WHERE user_id=?').run(config.cupsForFree, userId)
}

function setCashback(userId: number, rub: number) {
  db.prepare('UPDATE users SET cashback_balance=? WHERE id=?').run(rub * 100, userId)
}

function grantVoucher(userId: number, kind: 'percent' | 'fixed', value: number) {
  const tmpl = db
    .prepare('INSERT INTO voucher_templates(code,title,kind,value,valid_days) VALUES(?,?,?,?,?)')
    .run(uniq('T'), 'Скидка', kind, value, 30)
  const templateId = Number(tmpl.lastInsertRowid)
  const v = db
    .prepare('INSERT INTO vouchers(user_id,template_id,title,kind,value,expires_day) VALUES(?,?,?,?,?,?)')
    .run(userId, templateId, 'Скидка', kind, value, Math.floor(Date.now() / 86_400_000) + 30)
  return Number(v.lastInsertRowid)
}

const reservation = (id: string) =>
  db.prepare('SELECT id, status, benefit_free, benefit_cb, benefit_voucher_ids FROM loyalty_reservations WHERE id=?').get(id) as
    | { id: string; status: string; benefit_free: number; benefit_cb: number; benefit_voucher_ids: string }
    | undefined

beforeEach(() => {
  const t = Date.now()
  db.prepare(`INSERT OR REPLACE INTO stores(id,name,address) VALUES(?,?,?)`).run(STORE, 'Точка', 'ул. 1')
  db.prepare(
    `INSERT OR REPLACE INTO products(id,name,price,available,icon,counts_as_cup,free_eligible,sort_order,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(CUP, 'Капучино', 300, 1, 'Coffee', 1, 1, 1, t, t)
  db.prepare(
    `INSERT OR REPLACE INTO products(id,name,price,available,icon,counts_as_cup,free_eligible,sort_order,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(FOOD, 'Круассан', 190, 1, 'Croissant', 0, 0, 2, t, t)
  db.prepare(`DELETE FROM preorders`).run()
  db.prepare(`DELETE FROM preorder_bans`).run()
  db.prepare(`DELETE FROM loyalty_reservations`).run()
  db.prepare(`DELETE FROM app_settings WHERE key LIKE 'preorder%'`).run()
})

describe('quote', () => {
  it('без бонуса: сумма = позиции, discount 0', async () => {
    const g = await guest()
    const { status, body } = await quote(g, [{ productId: String(CUP), quantity: 2 }])
    expect(status).toBe(200)
    expect(body).toMatchObject({ subtotal: 600, discount: 0, total: 600, benefit: null })
    expect(String(body.quoteToken)).toMatch(/^q1\./)
  })

  it('платные модификаторы входят в сумму, цена берётся из справочника', async () => {
    const t = Date.now()
    db.prepare(`INSERT OR REPLACE INTO modifiers(id,name,price,group_key,available,sort_order,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(9001, 'Ваниль', 40, 'syrup', 1, 0, t, t)
    db.prepare(`INSERT OR REPLACE INTO modifiers(id,name,price,group_key,available,sort_order,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(9002, 'Овсяное', 50, 'milk', 0, 0, t, t)
    const g = await guest()
    const { body } = await quote(g, [
      { productId: String(CUP), quantity: 1, modifiers: [{ modifierId: '9001' }, { modifierId: '9001' }] },
      // Выключенный модификатор не участвует: его цену касса посчитает по своему каталогу.
      { productId: String(FOOD), quantity: 1, modifiers: [{ modifierId: '9002' }] },
    ])
    expect(body.subtotal).toBe(300 + 80 + 190)
    expect(body.items[0]).toMatchObject({ unitPriceEstimate: 380, sum: 380 })
  })

  it('подарок: списывает самый дорогой напиток, еда не участвует', async () => {
    const g = await guest()
    makeGiftEligible(g.userId)
    const { body } = await quote(g, [{ productId: String(FOOD), quantity: 1 }, { productId: String(CUP), quantity: 1 }], { kind: 'gift' })
    expect(body.subtotal).toBe(490)
    expect(body.discount).toBe(300)
    expect(body.benefit).toMatchObject({ kind: 'gift', amountRub: 300 })
    expect(body.total).toBe(190)
  })

  it('подарок без права — понятная ошибка', async () => {
    const g = await guest()
    const { status, body } = await quote(g, [{ productId: String(CUP), quantity: 1 }], { kind: 'gift' })
    expect(status).toBe(409)
    expect(body.error).toBe('benefit_not_available')
  })

  it('кэшбэк: не больше остатка и не больше суммы', async () => {
    const g = await guest()
    setCashback(g.userId, 250)
    const big = await quote(g, [{ productId: String(CUP), quantity: 2 }], { kind: 'cashback' })
    expect(big.body.discount).toBe(250)
    expect(big.body.total).toBe(350)
    const small = await quote(g, [{ productId: String(FOOD), quantity: 1 }], { kind: 'cashback' })
    expect(small.body.discount).toBe(190)
    expect(small.body.total).toBe(0)
  })

  it('ваучер-процент и ваучер-сумма', async () => {
    const g = await guest()
    const percent = grantVoucher(g.userId, 'percent', 10)
    const fixed = grantVoucher(g.userId, 'fixed', 15_000) // 150 ₽ в копейках
    const p = await quote(g, [{ productId: String(CUP), quantity: 1 }], { kind: 'voucher', voucherId: percent })
    expect(p.body.discount).toBe(30)
    const f = await quote(g, [{ productId: String(CUP), quantity: 1 }], { kind: 'voucher', voucherId: fixed })
    expect(f.body.discount).toBe(150)
  })

  it('чужой или погашенный ваучер — benefit_stale', async () => {
    const g = await guest()
    const other = await guest()
    const vid = grantVoucher(other.userId, 'percent', 10)
    const { status, body } = await quote(g, [{ productId: String(CUP), quantity: 1 }], { kind: 'voucher', voucherId: vid })
    expect(status).toBe(409)
    expect(body.error).toBe('benefit_stale')
  })

  it('пустая корзина и недоступный товар', async () => {
    const g = await guest()
    expect((await quote(g, [])).body.error).toBe('empty_items')
    db.prepare('UPDATE products SET available=0 WHERE id=?').run(FOOD)
    expect((await quote(g, [{ productId: String(FOOD), quantity: 1 }])).body.error).toBe('product_unavailable')
    db.prepare('UPDATE products SET available=1 WHERE id=?').run(FOOD)
  })
})

describe('заказ с бонусом', () => {
  it('сохраняет benefit, quoteTotal и резерв лояльности', async () => {
    const g = await guest()
    makeGiftEligible(g.userId)
    const q = await quote(g, [{ productId: String(CUP), quantity: 1 }], { kind: 'gift' })
    expect(q.status).toBe(200)

    const o = await createOrder(g, [{ productId: String(CUP), quantity: 1 }], q.body.quoteToken)
    expect(o.status).toBe(200)
    expect(o.body.order).toMatchObject({ benefit: { kind: 'gift', amountRub: 300 }, quoteTotal: 0 })

    const row = db.prepare('SELECT benefit_json, reservation_id, quote_total FROM preorders WHERE id=?').get(o.body.order.id) as {
      benefit_json: string; reservation_id: string; quote_total: number
    }
    expect(row.quote_total).toBe(0)
    expect(row.reservation_id).toBeTruthy()
    const res = reservation(row.reservation_id)!
    expect(res.status).toBe('RESERVED')
    expect(res.benefit_free).toBe(1)
  })

  it('кэшбэк кладёт сумму в резерв (копейки)', async () => {
    const g = await guest()
    setCashback(g.userId, 100)
    const q = await quote(g, [{ productId: String(CUP), quantity: 1 }], { kind: 'cashback' })
    const o = await createOrder(g, [{ productId: String(CUP), quantity: 1 }], q.body.quoteToken)
    expect(o.status).toBe(200)
    const row = db.prepare('SELECT reservation_id FROM preorders WHERE id=?').get(o.body.order.id) as { reservation_id: string }
    expect(reservation(row.reservation_id)!.benefit_cb).toBe(10000)
  })

  it('ваучер попадает в резерв и в заказ', async () => {
    const g = await guest()
    const vid = grantVoucher(g.userId, 'percent', 10)
    const q = await quote(g, [{ productId: String(CUP), quantity: 1 }], { kind: 'voucher', voucherId: vid })
    const o = await createOrder(g, [{ productId: String(CUP), quantity: 1 }], q.body.quoteToken)
    expect(o.body.order.benefit).toMatchObject({ kind: 'voucher', voucherId: vid })
    const row = db.prepare('SELECT reservation_id FROM preorders WHERE id=?').get(o.body.order.id) as { reservation_id: string }
    expect(reservation(row.reservation_id)!.benefit_voucher_ids).toBe(`[${vid}]`)
  })

  it('без quoteToken заказ создаётся как раньше, benefit = null', async () => {
    const g = await guest()
    const o = await createOrder(g, [{ productId: String(CUP), quantity: 1 }])
    expect(o.status).toBe(200)
    expect(o.body.order.benefit).toBeNull()
    expect(o.body.order.quoteTotal).toBeNull()
  })

  it('состав изменился после quote → quote_stale', async () => {
    const g = await guest()
    const q = await quote(g, [{ productId: String(CUP), quantity: 1 }])
    const o = await createOrder(g, [{ productId: String(CUP), quantity: 2 }], q.body.quoteToken)
    expect(o.status).toBe(409)
    expect(o.body.error).toBe('quote_stale')
  })

  it('чужой quote не принимается', async () => {
    const g = await guest()
    const other = await guest()
    const q = await quote(other, [{ productId: String(CUP), quantity: 1 }])
    const o = await createOrder(g, [{ productId: String(CUP), quantity: 1 }], q.body.quoteToken)
    expect(o.status).toBe(409)
    expect(o.body.error).toBe('quote_stale')
  })

  it('отмена заказа освобождает резерв', async () => {
    const g = await guest()
    makeGiftEligible(g.userId)
    const q = await quote(g, [{ productId: String(CUP), quantity: 1 }], { kind: 'gift' })
    const o = await createOrder(g, [{ productId: String(CUP), quantity: 1 }], q.body.quoteToken)
    const row = db.prepare('SELECT reservation_id FROM preorders WHERE id=?').get(o.body.order.id) as { reservation_id: string }
    const cancel = await app.request(`/api/orders/${o.body.order.id}/cancel`, {
      method: 'POST', headers: { ...JSONH, ...auth(g.token) }, body: '{}',
    })
    expect(cancel.status).toBe(200)
    expect(reservation(row.reservation_id)!.status).toBe('EXPIRED')
  })
})
