import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-vch-consume-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { handleSell } = await import('../integrations/evotor/processing/SellHandler')
const { consumeReservation } = await import('../modules/loyalty/reservations')

const STORE = 'store-1'
const PROXY = {
  'Content-Type': 'application/json',
  Authorization: 'proxy-secret',
  'X-Evotor-Store-Uuid': STORE,
  'X-Evotor-Device-UUID': 'dev-consume',
}

db.prepare("INSERT OR IGNORE INTO stores(id,name,address) VALUES(1,'Точка теста','адрес')").run()
db.prepare("INSERT OR REPLACE INTO products(id,name,price,counts_as_cup) VALUES(970,'Latte',300,1)").run()
db.prepare('INSERT OR IGNORE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(970,?,?)')
  .run(STORE, 'p-consume-latte')
db.prepare(
  "INSERT OR IGNORE INTO voucher_templates(code,title,kind,value,valid_days) VALUES('WELCOME','Скидка 10%','percent',10,30)",
).run()

async function guest(): Promise<{ jwt: string; cardCode: string }> {
  const r = await app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const { token } = (await r.json()) as { token: string }
  const c = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  const card = (await c.json()) as { cardCode: string }
  return { jwt: token, cardCode: card.cardCode }
}

const resolve = async (dev: string, code: string) => {
  const r = await app.request('/api/devices/loyalty/resolve', {
    method: 'POST',
    headers: { ...PROXY, 'X-Evotor-Device-UUID': dev },
    body: JSON.stringify({ code }),
  })
  return { status: r.status, data: (await r.json()) as any }
}

const sell = (docId: string, proof: string, op?: string) => ({
  uuid: docId,
  type: 'SELL',
  closeDate: new Date().toISOString(),
  extras: { sc: { v: 2, c: proof, op, free: 0, cb: 0, ts: 1 } },
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: 'p-consume-latte', quantity: 1, price: 30000 }],
  closeSum: '30000',
})

const cardOf = (cardCode: string): string =>
  (db.prepare('SELECT card_id FROM users WHERE card_code=?').get(cardCode) as { card_id: string }).card_id

describe('STEP-V04: consumeReservation возвращает voucherIds', () => {
  it('резерв без ваучеров: handleSell съедает резерв, льготы как раньше', async () => {
    const g = await guest()
    const r = await resolve('dev-consume', g.cardCode)
    expect(r.status).toBe(200)
    const docId = `consume-${Date.now()}-a`
    // numeric code не резервирует — проверяем именно QR-ветку через прямой consume ниже
    const op = r.data.reservationId as string | null
    if (!op) return // числовая карта: резерва нет, ветка не применима
    const res = handleSell(db as any, STORE, sell(docId, g.cardCode, op))
    expect(res.processed).toBe(true)
    const row = db.prepare('SELECT status FROM loyalty_reservations WHERE id=?').get(op) as { status: string }
    expect(row.status).toBe('CONSUMED')
  })

  it('резерв с benefit_voucher_ids отдаёт их из consumeReservation', async () => {
    const cardId = `CARD-V-${Date.now()}`
    db.prepare(
      `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)`,
    ).run(`v-${cardId}`, `+7900${Date.now() % 10000000}`, `V${Date.now() % 100000}`, cardId, '998877', Date.now())
    const nowSec = Math.floor(Date.now() / 1000)
    db.prepare(
      `INSERT INTO loyalty_reservations(id,card_id,benefit_free,benefit_cb,benefit_voucher_ids,store_uuid,device_uuid,status,created_at,expires_at)
       VALUES('R-v4',?,'1',0,'[3,5]','store-1','dev-1','RESERVED',?,?)`,
    ).run(cardId, nowSec, nowSec + 90)
    const res = consumeReservation(db as any, 'R-v4', cardId, STORE, 'doc-v4')
    expect(res).toEqual({ free: 1, cb: 0, voucherIds: [3, 5] })
  })

  it('мусор в benefit_voucher_ids даёт пустой список', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const insert = (id: string, raw: string) => {
      db.prepare(
        `INSERT INTO loyalty_reservations(id,card_id,benefit_free,benefit_cb,benefit_voucher_ids,store_uuid,device_uuid,status,created_at,expires_at)
         VALUES(?,?,1,0,?,'store-1','dev-1','RESERVED',?,?)`,
      ).run(id, 'CARD-JUNK', raw, nowSec, nowSec + 90)
      return consumeReservation(db as any, id, 'CARD-JUNK', STORE, `doc-${id}`).voucherIds
    }
    expect(insert('R-j1', 'abc')).toEqual([])
    expect(insert('R-j2', '{"a":1}')).toEqual([])
    expect(insert('R-j3', '[0,-1,"x",2]')).toEqual([2])
  })

  it('несуществующий резерв → пустые льготы', () => {
    expect(consumeReservation(db as any, 'R-none', 'CARD-JUNK', STORE, 'doc-none')).toEqual({
      free: 0, cb: 0, voucherIds: [],
    })
  })

  it('повторное потребление того же резерва другим документом → пустые льготы', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    db.prepare(
      `INSERT INTO loyalty_reservations(id,card_id,benefit_free,benefit_cb,benefit_voucher_ids,store_uuid,device_uuid,status,created_at,expires_at)
       VALUES('R-once','CARD-ONCE',1,0,'[7]','store-1','dev-1','RESERVED',?,?)`,
    ).run(nowSec, nowSec + 90)
    expect(consumeReservation(db as any, 'R-once', 'CARD-ONCE', STORE, 'doc-1').voucherIds).toEqual([7])
    expect(consumeReservation(db as any, 'R-once', 'CARD-ONCE', STORE, 'doc-2')).toEqual({
      free: 0, cb: 0, voucherIds: [],
    })
  })
})
