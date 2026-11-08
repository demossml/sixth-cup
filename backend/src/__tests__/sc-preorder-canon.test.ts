/**
 * P0-3 (backend): льгота предзаказа привязана к id заказа, а не к номеру очереди.
 *
 * Канон для кассы: `sc.preorder = <uuid заказа>`.
 * `sc.ord` — id очереди (`queue_numbers`), он не должен списывать чужой бонус.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-preorder-canon-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const { ensurePreorderTables } = await import('../modules/orders/service')
const { handleSell, resolvePreorderId, looksLikeOrderId } = await import('../integrations/evotor/processing/SellHandler')
const { buildCardProof, ensureCardCode } = await import('../modules/loyalty/proof')

const STORE = 'store-canon'
const ORDER_A = '11111111-1111-4111-8111-111111111111'
const ORDER_B = '22222222-2222-4222-8222-222222222222'
const CARD = 'CARD-CANON-1'
const CARD_CODE = '9077'

function seedOrder(id: string, reservationId: string, kind: 'gift' | 'cashback') {
  const t = Math.floor(Date.now() / 1000)
  db.prepare(`INSERT OR REPLACE INTO preorders(id, short_code, store_id, status, guest_user_id, estimate_total, currency, expires_at, created_at, updated_at, benefit_json, reservation_id)
    VALUES(?,?,?,?,?,?, 'RUB', ?, ?, ?, ?, ?)`)
    .run(id, '111111', 1, 'ready', 77, 300, t + 600, t, t,
      JSON.stringify({ kind, title: kind === 'gift' ? 'Подарок' : 'Кэшбэк', amountRub: kind === 'gift' ? 300 : 100 }),
      reservationId)
  db.prepare(`INSERT OR REPLACE INTO loyalty_reservations(id, card_id, benefit_free, benefit_cb, status, created_at, expires_at)
    VALUES(?,?,?,?, 'RESERVED', ?, ?)`)
    .run(reservationId, CARD, kind === 'gift' ? 1 : 0, kind === 'cashback' ? 10000 : 0, t, t + 600)
}

const sell = (sc: Record<string, unknown>) => ({
  uuid: `doc-${Math.random().toString(36).slice(2)}`,
  type: 'SELL',
  closeDate: new Date().toISOString(),
  extras: { sc: { v: 2, c: CARD_CODE, free: 0, cb: 0, ts: 1, ...sc } },
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: 'commodity-1', quantity: 1, price: 30000 }],
  closeSum: '30000',
})

beforeEach(() => {
  ensurePreorderTables(db as never)
  db.prepare(`INSERT OR REPLACE INTO stores(id,name,address) VALUES(1,'Точка','ул. 1')`).run()
  db.prepare(`INSERT OR REPLACE INTO evotor_stores(store_uuid,name,local_store_id,updated_at) VALUES(?,?,1,?)`)
    .run(STORE, 'Точка', Date.now())
  db.prepare(`INSERT OR REPLACE INTO users(id,nickname,phone,invite_code,card_id,card_code,created_at)
    VALUES(77,'canon','+70000000077','CANON77',?,?,?)`).run(CARD, CARD_CODE, Math.floor(Date.now() / 1000))
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(77, ?)').run(Date.now())
  ensureCardCode(77)
  db.prepare('DELETE FROM loyalty_reservations').run()
  db.prepare('DELETE FROM preorders').run()
})

describe('канон sc.preorder', () => {
  it('looksLikeOrderId отличает uuid от номера очереди', () => {
    expect(looksLikeOrderId(ORDER_A)).toBe(true)
    expect(looksLikeOrderId('42')).toBe(false)
    expect(looksLikeOrderId('111111')).toBe(false)
  })

  it('sc.preorder = id заказа → льгота найдена', () => {
    seedOrder(ORDER_A, 'R-canon-1', 'gift')
    expect(resolvePreorderId(db as never, { preorder: ORDER_A })).toEqual({ orderId: ORDER_A, legacy: false })
  })

  it('sc.ord с номером очереди не считается заказом (чужой бонус не списываем)', () => {
    seedOrder(ORDER_A, 'R-canon-2', 'gift')
    expect(resolvePreorderId(db as never, { ord: '42' })).toEqual({ orderId: null, legacy: false })
    expect(resolvePreorderId(db as never, { ord: '111111' })).toEqual({ orderId: null, legacy: false })
  })

  it('sc.ord с uuid заказа — legacy fallback, помечается для деprecation', () => {
    seedOrder(ORDER_A, 'R-canon-3', 'gift')
    expect(resolvePreorderId(db as never, { ord: ORDER_A })).toEqual({ orderId: ORDER_A, legacy: true })
  })

  it('sc.preorder с несуществующим заказом → льгот нет', () => {
    seedOrder(ORDER_A, 'R-canon-4', 'gift')
    expect(resolvePreorderId(db as never, { preorder: ORDER_B })).toEqual({ orderId: null, legacy: false })
  })

  it('SELL с sc.preorder списывает резерв именно этого заказа', () => {
    seedOrder(ORDER_A, 'R-canon-5', 'gift')
    const proof = buildCardProof(77)
    const res = handleSell(db as never, STORE, sell({ c: proof, preorder: ORDER_A, free: 1, cb: 0 }))
    expect(res.processed).toBe(true)
    const r = db.prepare('SELECT status FROM loyalty_reservations WHERE id=?').get('R-canon-5') as { status: string }
    expect(r.status).toBe('CONSUMED')
  })

  it('SELL с sc.ord = номер очереди не трогает резерв заказа', () => {
    seedOrder(ORDER_A, 'R-canon-6', 'gift')
    const proof = buildCardProof(77)
    const res = handleSell(db as never, STORE, sell({ c: proof, ord: '111111', free: 0, cb: 0 }))
    expect(res.processed).toBe(true)
    const r = db.prepare('SELECT status FROM loyalty_reservations WHERE id=?').get('R-canon-6') as { status: string }
    expect(r.status).toBe('RESERVED')
  })
})
