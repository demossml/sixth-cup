/**
 * P1-5: масштаб денег берётся из настройки точки, а не из эвристики «≥1000 = копейки».
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-money-scale-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const { ensurePreorderTables } = await import('../modules/orders/service')
const { handleSell, moneyScaleForStore } = await import('../integrations/evotor/processing/SellHandler')
const { buildCardProof } = await import('../modules/loyalty/proof')

const STORE_UUID = 'ev-money'
const LOCAL_STORE = 21
const CARD = 'CARD-MONEY'
const CODE = '9155'

function sell(price: number) {
  return {
    uuid: `doc-${Math.random().toString(36).slice(2)}`,
    type: 'SELL',
    closeDate: new Date().toISOString(),
    extras: { sc: { v: 2, c: buildCardProof(78), free: 0, cb: 0, ts: 1 } },
    transactions: [{ type: 'REGISTER_POSITION', commodityUuid: 'c-1', quantity: 1, price }],
    closeSum: String(price),
  }
}

beforeEach(() => {
  ensurePreorderTables(db as never)
  const t = Math.floor(Date.now() / 1000)
  db.prepare(`INSERT OR REPLACE INTO stores(id,name,address) VALUES(?,?,?)`).run(LOCAL_STORE, 'Деньги', 'ул. 1')
  db.prepare(`INSERT OR REPLACE INTO evotor_stores(store_uuid,name,local_store_id,updated_at) VALUES(?,?,?,?)`)
    .run(STORE_UUID, 'Деньги', LOCAL_STORE, Date.now())
  db.prepare(`INSERT OR REPLACE INTO users(id,nickname,phone,invite_code,card_id,card_code,created_at)
    VALUES(78,'money','+70000000078','MONEY78',?,?,?)`).run(CARD, CODE, t)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(78, ?)').run(Date.now())
  db.prepare('UPDATE cards SET paid_total=0, free_used=0 WHERE user_id=78').run()
  db.prepare('DELETE FROM loyalty_ops').run()
  db.prepare('DELETE FROM receipts').run()
})

const amount = (doc: Record<string, unknown>) => {
  const res = handleSell(db as never, STORE_UUID, doc)
  expect(res.processed).toBe(true)
  // Сумма чека фиксируется в loyalty_ops.result_rub (рубли с копейками) — по ней видно масштаб.
  const row = db.prepare(`SELECT result_rub AS rub FROM loyalty_ops WHERE kind='SELL' ORDER BY created_at DESC LIMIT 1`)
    .get() as { rub: number } | undefined
  return Math.round(Number(row?.rub ?? 0) * 100)
}

describe('P1-5 денежный масштаб', () => {
  it('auto: прежняя эвристика по цене ≥ 1000', () => {
    db.prepare(`UPDATE stores SET money_scale='auto' WHERE id=?`).run(LOCAL_STORE)
    expect(moneyScaleForStore(db as never, STORE_UUID)).toBe('auto')
    expect(amount(sell(15000))).toBe(15000) // уже копейки
    expect(amount(sell(150))).toBe(15000) // рубли → копейки
  })

  it('явные rub: даже «15000» считается рублями', () => {
    db.prepare(`UPDATE stores SET money_scale='rub' WHERE id=?`).run(LOCAL_STORE)
    expect(moneyScaleForStore(db as never, STORE_UUID)).toBe('rub')
    expect(amount(sell(15000))).toBe(1_500_000)
  })

  it('явные kopecks: «150» не умножается на 100', () => {
    db.prepare(`UPDATE stores SET money_scale='kopecks' WHERE id=?`).run(LOCAL_STORE)
    expect(moneyScaleForStore(db as never, STORE_UUID)).toBe('kopecks')
    expect(amount(sell(150))).toBe(150)
  })
})
