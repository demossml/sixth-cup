import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-vch-redeem-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { handleSell } = await import('../integrations/evotor/processing/SellHandler')
const { config } = await import('../config')
const { todayDay } = await import('../modules/vouchers/service')

const STORE = 'store-1'
const proxy = (dev: string) => ({
  'Content-Type': 'application/json',
  Authorization: 'proxy-secret',
  'X-Evotor-Store-Uuid': STORE,
  'X-Evotor-Device-UUID': dev,
})

db.prepare("INSERT OR IGNORE INTO stores(id,name,address) VALUES(1,'Точка теста','адрес')").run()
db.prepare("INSERT OR REPLACE INTO products(id,name,price,counts_as_cup) VALUES(980,'Latte',200,1)").run()
db.prepare('INSERT OR IGNORE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(980,?,?)')
  .run(STORE, 'p-redeem-latte')
db.prepare(
  "INSERT OR IGNORE INTO voucher_templates(code,title,kind,value,valid_days) VALUES('WELCOME','Скидка 10%','percent',10,30)",
).run()

let seq = 0
const uniq = (p: string) => `${p}-${++seq}-${Date.now()}`

async function guest(): Promise<{ jwt: string; card: { card: string; cardCode: string } }> {
  const r = await app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const { token } = (await r.json()) as { token: string }
  const c = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  return { jwt: token, card: (await c.json()) as { card: string; cardCode: string } }
}

const userIdOf = (cardCode: string): number =>
  (db.prepare('SELECT id FROM users WHERE card_code=?').get(cardCode) as { id: number }).id

const resolve = async (dev: string, code: string) => {
  const r = await app.request('/api/devices/loyalty/resolve', {
    method: 'POST',
    headers: proxy(dev),
    body: JSON.stringify({ code }),
  })
  return { status: r.status, data: (await r.json()) as any }
}

function templateId(): number {
  return (db.prepare("SELECT id FROM voucher_templates WHERE code='WELCOME'").get() as { id: number }).id
}

function give(userId: number, opts: { title?: string; kind?: 'percent' | 'fixed'; value?: number; expiresDay?: number } = {}): number {
  const info = db
    .prepare('INSERT INTO vouchers(user_id,template_id,title,kind,value,expires_day) VALUES(?,?,?,?,?,?)')
    .run(
      userId,
      templateId(),
      opts.title ?? 'Скидка 10%',
      opts.kind ?? 'percent',
      opts.value ?? 10,
      opts.expiresDay ?? todayDay() + 10,
    )
  return Number(info.lastInsertRowid)
}

const sell = (docId: string, code: string, sc: Record<string, unknown> = {}) => ({
  uuid: docId,
  type: 'SELL',
  closeDate: new Date().toISOString(),
  extras: { sc: { v: 2, c: code, op: undefined, free: 0, cb: 0, ts: 1, ...sc } },
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: 'p-redeem-latte', quantity: 1, price: 20000 }],
  closeSum: '20000',
})

const voucherRow = (id: number) =>
  db.prepare('SELECT used_at AS usedAt, receipt_id AS receiptId FROM vouchers WHERE id=?')
    .get(id) as { usedAt: number | null; receiptId: string | null }
const opsRow = (docId: string) =>
  db.prepare('SELECT voucher FROM loyalty_ops WHERE doc_id=?').get(docId) as { voucher: string | null }
const disputes = (docId: string) =>
  db.prepare('SELECT kind, details FROM disputes WHERE receipt_id=?').all(docId) as { kind: string; details: string }[]
const cardState = (cardCode: string) =>
  db.prepare('SELECT paid_total AS paid, free_used AS freeUsed FROM cards WHERE user_id=?')
    .get(userIdOf(cardCode)) as { paid: number; freeUsed: number }

beforeEach(() => {
  config.vouchersInResolve = true
})

describe('STEP-V06: погашение ваучера в SellHandler', () => {
  it('успех: used_at, receipt_id, loyalty_ops.voucher, без споров', async () => {
    const g = await guest()
    const id = give(userIdOf(g.card.cardCode))
    const r = await resolve('dev-A', g.card.card)
    const docId = uniq('sell')
    const res = handleSell(db as any, STORE, sell(docId, g.card.card, { op: r.data.reservationId, voucherId: id }))

    expect(res.processed).toBe(true)
    expect(voucherRow(id).usedAt).not.toBeNull()
    expect(voucherRow(id).receiptId).toBe(docId)
    expect(opsRow(docId).voucher).toBe(String(id))
    expect(disputes(docId)).toHaveLength(0)
  })

  it('повтор того же документа не гасит второй раз и не плодит споры', async () => {
    const g = await guest()
    const id = give(userIdOf(g.card.cardCode))
    const r = await resolve('dev-A', g.card.card)
    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, g.card.card, { op: r.data.reservationId, voucherId: id }))
    const first = voucherRow(id)
    const again = handleSell(db as any, STORE, sell(docId, g.card.card, { op: r.data.reservationId, voucherId: id }))
    expect((again as any).reason).toBe('duplicate')
    expect(voucherRow(id)).toEqual(first)
    expect(disputes(docId)).toHaveLength(0)
  })

  it('двойное гашение другим документом → voucher_double_use', async () => {
    const g = await guest()
    const cardId = (db.prepare('SELECT card_id FROM users WHERE card_code=?').get(g.card.cardCode) as { card_id: string }).card_id
    const id = give(userIdOf(g.card.cardCode))
    const r = await resolve('dev-A', g.card.card)
    const doc1 = uniq('sell')
    handleSell(db as any, STORE, sell(doc1, g.card.card, { op: r.data.reservationId, voucherId: id }))
    const first = voucherRow(id)

    // второй чек: новый активный резерв с тем же ваучером в списке
    const nowSec = Math.floor(Date.now() / 1000)
    db.prepare(
      `INSERT INTO loyalty_reservations(id,card_id,benefit_free,benefit_cb,benefit_voucher_ids,store_uuid,device_uuid,status,created_at,expires_at)
       VALUES('R-dup',?,0,0,?,'store-1','dev-A','RESERVED',?,?)`,
    ).run(cardId, JSON.stringify([id]), nowSec, nowSec + 90)
    const doc2 = uniq('sell')
    handleSell(db as any, STORE, sell(doc2, g.card.card, { op: 'R-dup', voucherId: id }))

    const d = disputes(doc2)
    expect(d.map((x) => x.kind)).toEqual(['voucher_double_use'])
    expect(JSON.parse(d[0].details).voucherId).toBe(id)
    expect(voucherRow(id)).toEqual(first)
  })

  it('ваучер вне резерва → voucher_invalid/not_in_reservation', async () => {
    const g = await guest()
    const uid = userIdOf(g.card.cardCode)
    const id1 = give(uid, { title: 'Первый' })
    const id2 = give(uid, { title: 'Второй' })
    const r = await resolve('dev-A', g.card.card)
    expect(r.data.vouchers.map((v: any) => v.id)).toEqual([id1, id2])
    // оставляем в резерве только первый
    db.prepare('UPDATE loyalty_reservations SET benefit_voucher_ids=? WHERE id=?')
      .run(JSON.stringify([id1]), r.data.reservationId)

    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, g.card.card, { op: r.data.reservationId, voucherId: id2 }))
    const d = disputes(docId)
    expect(d.map((x) => x.kind)).toEqual(['voucher_invalid'])
    expect(JSON.parse(d[0].details).reason).toBe('not_in_reservation')
    expect(voucherRow(id1).usedAt).toBeNull()
    expect(voucherRow(id2).usedAt).toBeNull()
  })

  it('чужой ваучер → voucher_invalid/foreign, чужая строка не тронута', async () => {
    const owner = await guest()
    const stranger = await guest()
    const foreign = give(userIdOf(owner.card.cardCode))
    const r = await resolve('dev-A', stranger.card.card)
    db.prepare('UPDATE loyalty_reservations SET benefit_voucher_ids=? WHERE id=?')
      .run(JSON.stringify([foreign]), r.data.reservationId)

    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, stranger.card.card, { op: r.data.reservationId, voucherId: foreign }))
    const d = disputes(docId)
    expect(d.map((x) => x.kind)).toEqual(['voucher_invalid'])
    expect(JSON.parse(d[0].details).reason).toBe('foreign')
    expect(voucherRow(foreign).usedAt).toBeNull()
  })

  it('ваучер просрочен между резервом и чеком → voucher_invalid/expired', async () => {
    const g = await guest()
    const id = give(userIdOf(g.card.cardCode))
    const r = await resolve('dev-A', g.card.card)
    db.prepare('UPDATE vouchers SET expires_day=? WHERE id=?').run(todayDay() - 1, id)

    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, g.card.card, { op: r.data.reservationId, voucherId: id }))
    const d = disputes(docId)
    expect(d.map((x) => x.kind)).toEqual(['voucher_invalid'])
    expect(JSON.parse(d[0].details).reason).toBe('expired')
    expect(voucherRow(id).usedAt).toBeNull()
  })

  it('числовой код: voucher_invalid/numeric_code, ваучер не погашен, чашка начислена', async () => {
    const g = await guest()
    const id = give(userIdOf(g.card.cardCode))
    const before = cardState(g.card.cardCode)
    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, g.card.cardCode, { voucherId: id }))
    const d = disputes(docId)
    expect(d.map((x) => x.kind)).toEqual(['voucher_invalid'])
    expect(JSON.parse(d[0].details).reason).toBe('numeric_code')
    expect(voucherRow(id).usedAt).toBeNull()
    expect(cardState(g.card.cardCode).paid).toBe(before.paid + 1)
  })

  it('без voucherId: loyalty_ops.voucher NULL и никаких споров', async () => {
    const g = await guest()
    const r = await resolve('dev-A', g.card.card)
    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, g.card.card, { op: r.data.reservationId }))
    expect(opsRow(docId).voucher).toBeNull()
    expect(disputes(docId)).toHaveLength(0)
  })

  it('ваучер не меняет прогресс чашек, реферальный бонус считается от closeSum', async () => {
    // пригласивший и его друг
    const inviter = await guest()
    const inviterId = userIdOf(inviter.card.cardCode)
    const inviteCode = (db.prepare('SELECT invite_code FROM users WHERE id=?').get(inviterId) as { invite_code: string }).invite_code
    const reg = await app.request('/api/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode }),
    })
    const { token } = (await reg.json()) as { token: string }
    const friendCard = (await (await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      card: string
      cardCode: string
    }
    const friendId = userIdOf(friendCard.cardCode)
    const id = give(friendId)
    const r = await resolve('dev-F', friendCard.card)
    const before = cardState(friendCard.cardCode)

    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, friendCard.card, { op: r.data.reservationId, voucherId: id }))

    expect(cardState(friendCard.cardCode).paid).toBe(before.paid + 1)
    const bonus = (db.prepare('SELECT amount FROM cashback_ledger WHERE beneficiary_id=? AND receipt_id=?')
      .get(inviterId, docId) as { amount: number } | undefined)?.amount
    // closeSum 20000 копеек, 3 %
    expect(bonus).toBe(Math.floor((20000 * 3) / 100))
  })
})
