/**
 * BONUS-LOYALTY, STEP-5: начисление процента и списание с баланса при SELL,
 * сторно процента при PAYBACK. Флаг `LOYALTY_BONUS_MODE` здесь НЕ выключается —
 * это основной контур. Подарочный (чашечный) контур живёт в соседних тестах.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-bonus-sell-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.LOYALTY_BONUS_MODE = '1'

const { app } = await import('../app')
const { db } = await import('../db')
const { handleSell, handlePayback } = await import('../integrations/evotor/processing/SellHandler')
const { setUserBonusBps } = await import('../modules/loyalty/settings')

const APP_ID = '151071e8-88a4-44f6-b71a-b17c559f9b7d'
const COMMODITY = 'e4e11fb2-68d6-4a20-be08-279dec51e8f6'
const STORE = 'store-bonus-sell'

/** Чек на 1000 ₽ (100000 копеек): 2 × 500 ₽, цена уже в копейках. */
const sellDoc = (uuid: string, opts: { cb?: number; free?: number; code?: string; sum?: number } = {}) => {
  const sum = opts.sum ?? 100000
  return {
    uuid,
    type: 'SELL',
    extras: {
      [APP_ID]: { sc: { v: 2, c: opts.code ?? code, free: opts.free ?? 0, cb: opts.cb ?? 0, ts: 1 } },
    },
    transactions: [
      { type: 'REGISTER_POSITION', commodityUuid: COMMODITY, commodityName: 'Американо', quantity: 2, price: sum / 2, sum },
    ],
    closeSum: sum.toFixed(2),
  }
}

const paybackDoc = (uuid: string, base: string, sum: number) => ({
  uuid,
  type: 'PAYBACK',
  baseDocumentUUID: base,
  closeSum: sum.toFixed(2),
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: sum, sum }],
})

const admin = { 'Content-Type': 'application/json', 'X-Admin-Token': 'test-admin' }
let uid = 0
let cardId = ''
let code = '12'
let codeSeq = 0
let jwt = ''

const balance = () => Number((db.prepare('SELECT cashback_balance AS b FROM users WHERE id=?').get(uid) as { b: number }).b)
const cupsOf = () => db.prepare('SELECT paid_total AS p, free_used AS f FROM cards WHERE user_id=?').get(uid) as { p: number; f: number }
const ledger = (source: string) =>
  db.prepare('SELECT cashback_delta AS d FROM loyalty_ledger WHERE card_id=? AND source_type=? ORDER BY id').all(cardId, source) as { d: number }[]
const setBalance = (amount: number) => db.prepare('UPDATE users SET cashback_balance=? WHERE id=?').run(amount, uid).changes

beforeEach(async () => {
  db.prepare("DELETE FROM loyalty_ledger").run()
  db.prepare("DELETE FROM loyalty_ops WHERE doc_store=?").run(STORE)
  const r = await app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const { token } = (await r.json()) as { token: string }
  jwt = token
  await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  const row = db.prepare('SELECT user_id AS id FROM cards ORDER BY user_id DESC LIMIT 1').get() as { id: number }
  uid = row.id
  code = String(1000 + ++codeSeq)
  db.prepare('UPDATE users SET card_code=?, cashback_balance=0, bonus_percent_bps=NULL WHERE id=?').run(code, uid)
  cardId = (db.prepare('SELECT card_id AS c FROM users WHERE id=?').get(uid) as { c: string }).c

  const created = await app.request('/api/admin/products', {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ name: 'Американо', price: 500 }),
  })
  const { id: productId } = (await created.json()) as { id: number }
  db.prepare('DELETE FROM product_store_links WHERE store_uuid=?').run(STORE)
  db.prepare('INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)').run(productId, STORE, COMMODITY)
})

describe('SELL в бонусном режиме', () => {
  it('начисляет глобальные 5% с оплаченной суммы и не двигает чашки', () => {
    expect(handleSell(db, STORE, sellDoc('s1')).processed).toBe(true)
    expect(balance()).toBe(5000) // 5% от 1000 ₽ (списания бонусов нет)
    expect(ledger('EVOTOR_BONUS_EARN')).toEqual([{ d: 5000 }])
    expect(cupsOf()).toEqual({ p: 0, f: 0 }) // подарочные чашки не копятся
  })

  it('индивидуальный процент перекрывает глобальный', () => {
    setUserBonusBps(db, uid, 750, 'test')
    handleSell(db, STORE, sellDoc('s2'))
    expect(balance()).toBe(7500) // 7.5% от 1000 ₽
  })

  it('списал часть чека бонусами — начисления нет, баланс только уменьшается', () => {
    setBalance(20000)
    handleSell(db, STORE, sellDoc('s3', { cb: 100000 }))
    // списали 200 ₽ из 1000 ₽ → процент за этот чек не начисляется вообще (FIX 16.11.2026)
    expect(balance()).toBe(0)
    expect(ledger('EVOTOR_SELL')).toEqual([{ d: -20000 }])
    expect(ledger('EVOTOR_BONUS_EARN')).toEqual([])
  })

  it('списал ровно 1 копейку — начисления тоже нет', () => {
    setBalance(1)
    handleSell(db, STORE, sellDoc('s3a', { cb: 100000 }))
    expect(balance()).toBe(0)
    expect(ledger('EVOTOR_SELL')).toEqual([{ d: -1 }])
    expect(ledger('EVOTOR_BONUS_EARN')).toEqual([])
  })

  it('чек целиком оплачен бонусами — процент не начисляется', () => {
    setBalance(100000)
    handleSell(db, STORE, sellDoc('s4', { cb: 100000 }))
    expect(balance()).toBe(0)
    expect(ledger('EVOTOR_BONUS_EARN')).toEqual([])
  })

  it('повторный поллинг того же чека не начисляет второй раз', () => {
    handleSell(db, STORE, sellDoc('s5'))
    expect(handleSell(db, STORE, sellDoc('s5'))).toEqual({ processed: true, reason: 'duplicate' })
    expect(balance()).toBe(5000)
    expect(ledger('EVOTOR_BONUS_EARN')).toHaveLength(1)
  })

  it('подарочная чашка не применяется: free не списывается и не выдаётся', () => {
    // 5 «оплаченных» чашек в старом контуре дали бы freeAvailable=1
    db.prepare('UPDATE cards SET paid_total=4 WHERE user_id=?').run(uid)
    handleSell(db, STORE, sellDoc('s6', { free: 1 }))
    const sc = db.prepare("SELECT free, cups_counted AS cups FROM loyalty_ops WHERE doc_id='s6'").get() as { free: number; cups: number }
    expect(sc).toEqual({ free: 0, cups: 2 })
    expect(cupsOf()).toEqual({ p: 4, f: 0 }) // paid_total не растёт, free_used = 0
  })
})

describe('GET /api/loyalty/ledger (PWA)', () => {
  it('отдаёт свой баланс, процент и движения; без токена — 401', async () => {
    handleSell(db, STORE, sellDoc('l1'))
    expect((await app.request('/api/loyalty/ledger')).status).toBe(401)
    const r = await app.request('/api/loyalty/ledger?limit=10', { headers: { Authorization: `Bearer ${jwt}` } })
    expect(r.status).toBe(200)
    const body = (await r.json()) as any
    expect(body.balanceKopecks).toBe(5000)
    expect(body.effectiveEarnPercent).toBe(5)
    expect(body.items[0]).toMatchObject({ source: 'EVOTOR_BONUS_EARN', cashbackDelta: 5000 })
    expect(typeof body.items[0].at).toBe('string')
  })
})

describe('PAYBACK в бонусном режиме', () => {
  it('чек со списанием: возврат возвращает списанное, но не начисляет процент', () => {
    setBalance(20000)
    handleSell(db, STORE, sellDoc('p0', { cb: 100000 })) // списали 200 ₽, earn = 0
    expect(balance()).toBe(0)
    expect(handlePayback(db, STORE, paybackDoc('p0-back', 'p0', 100000)).processed).toBe(true)
    expect(balance()).toBe(20000) // только возврат списанного
    expect(ledger('EVOTOR_BONUS_EARN')).toEqual([])
  })

  it('полный возврат сторнирует начисленный процент', () => {
    handleSell(db, STORE, sellDoc('p1'))
    expect(balance()).toBe(5000)
    expect(handlePayback(db, STORE, paybackDoc('p1-back', 'p1', 100000)).processed).toBe(true)
    expect(balance()).toBe(0)
    expect(ledger('EVOTOR_BONUS_EARN')).toEqual([{ d: 5000 }, { d: -5000 }])
  })

  it('частичный возврат сторнирует пропорциональную долю', () => {
    handleSell(db, STORE, sellDoc('p2'))
    handlePayback(db, STORE, paybackDoc('p2-back', 'p2', 40000)) // вернули 40 %
    expect(balance()).toBe(3000) // 5000 − 2000
    expect(ledger('EVOTOR_BONUS_EARN')).toEqual([{ d: 5000 }, { d: -2000 }])
  })

  it('два частичных возврата не сторнируют больше начисленного', () => {
    handleSell(db, STORE, sellDoc('p3'))
    handlePayback(db, STORE, paybackDoc('p3-back-1', 'p3', 40000))
    handlePayback(db, STORE, paybackDoc('p3-back-2', 'p3', 90000))
    expect(balance()).toBe(0)
    const total = ledger('EVOTOR_BONUS_EARN').reduce((s, r) => s + r.d, 0)
    expect(total).toBe(0)
  })

  it('если бонус уже потрачен — сторно не уводит баланс в минус', () => {
    handleSell(db, STORE, sellDoc('p4'))
    setBalance(0) // гость успел потратить
    handlePayback(db, STORE, paybackDoc('p4-back', 'p4', 100000))
    expect(balance()).toBe(0)
    expect(db.prepare("SELECT 1 FROM disputes WHERE kind='bonus_earn_reversal_shortfall' AND receipt_id='p4'").get()).toBeTruthy()
  })
})
