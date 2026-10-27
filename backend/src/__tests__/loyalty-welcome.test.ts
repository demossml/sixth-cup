/**
 * L-09: приветственный ваучер выдаётся на первой платной чашке в любом канале
 * и не дублируется. Отсутствие шаблона не роняет продажу.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { handleSell } from '../integrations/evotor/processing/SellHandler'
import { grantVoucherOnce } from '../modules/vouchers/service'

const STORE = 'store-loy-welcome'
const COMMODITY = 'p-welcome-latte'

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`

function person(tag: string): { id: number; code: string } {
  const code = String(5000 + ++seq)
  const t = Date.now()
  db.prepare(
    `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)`,
  ).run(`wel-${tag}-${code}`, `+7200${code}`, `WEL${code}`, `CARD-${code}`, code, t)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, t)
  return { id, code }
}

const sellDoc = (docId: string, code: string) => ({
  uuid: docId,
  type: 'SELL',
  closeDate: new Date().toISOString(),
  extras: { sc: { v: 2, c: code, free: 0, cb: 0, ts: 1 } },
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: 30000 }],
  closeSum: '30000',
})

const welcomeCount = (userId: number) =>
  Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM vouchers v JOIN voucher_templates t ON t.id=v.template_id
           WHERE v.user_id=? AND t.code='WELCOME'`,
        )
        .get(userId) as { n: number }
    ).n,
  )

beforeEach(() => {
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,counts_as_cup) VALUES(960,'Latte',300,1)`).run()
  db.prepare(`INSERT OR IGNORE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(960,?,?)`).run(
    STORE,
    COMMODITY,
  )
  db.prepare(
    `INSERT OR IGNORE INTO voucher_templates(code,title,kind,value,valid_days) VALUES('WELCOME','Скидка 10% на первую покупку','percent',10,30)`,
  ).run()
})

describe('L-09: WELCOME в канале Эвотор', () => {
  it('первая платная чашка через Эвотор выдаёт ваучер', () => {
    const p = person('ev')
    const r = handleSell(db as any, STORE, sellDoc(uniq('sell'), p.code))
    expect(r.processed).toBe(true)
    expect(welcomeCount(p.id)).toBe(1)
  })

  it('вторая покупка не дублирует ваучер', () => {
    const p = person('ev2')
    handleSell(db as any, STORE, sellDoc(uniq('sell'), p.code))
    handleSell(db as any, STORE, sellDoc(uniq('sell'), p.code))
    expect(welcomeCount(p.id)).toBe(1)
  })

  it('идемпотентность: повторный grantVoucherOnce возвращает false', () => {
    const p = person('once')
    expect(grantVoucherOnce(p.id, 'WELCOME')).toBe(true)
    expect(grantVoucherOnce(p.id, 'WELCOME')).toBe(false)
    expect(welcomeCount(p.id)).toBe(1)
  })

  it('без шаблона продажа проходит, ваучер не создаётся', () => {
    db.prepare(`DELETE FROM voucher_templates WHERE code='WELCOME'`).run()
    const p = person('noTpl')
    const r = handleSell(db as any, STORE, sellDoc(uniq('sell'), p.code))
    expect(r.processed).toBe(true)
    expect(welcomeCount(p.id)).toBe(0)
  })
})
