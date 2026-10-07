import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-res-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { handleSell, handlePayback } = await import('../integrations/evotor/processing/SellHandler')

const proxy = (dev: string) => ({ 'Content-Type': 'application/json', Authorization: 'proxy-secret', 'X-Evotor-Store-Uuid': 'store-1', 'X-Evotor-Device-UUID': dev })

async function guest(invite?: string) {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invite ? { inviteCode: invite } : {}) })
  const { token } = await r.json() as { token: string }
  const c = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  return { jwt: token, card: await c.json() as any }
}
const resolve = async (dev: string, code: string) => {
  const r = await app.request('/api/devices/loyalty/resolve', { method: 'POST', headers: proxy(dev), body: JSON.stringify({ code }) })
  return { status: r.status, data: await r.json() as any }
}

// catalog: one product counted as a cup
db.prepare(`INSERT INTO products(id,name,price) VALUES(900,'Latte',200)`).run()
db.prepare(`UPDATE products SET counts_as_cup=1 WHERE id=900`).run()
db.prepare(`INSERT INTO evotor_products(product_id,variant,store_uuid,evotor_uuid) VALUES(900,'','store-1','p-latte')`).run()

const doc = (id: string, sc: object, qty = 1, sum = 200) => ({
  id, closeSum: sum, extras: { sc },
  transactions: [{ type: 'REGISTER_POSITION', productUuid: 'p-latte', quantity: qty }],
})

describe('proxy auth', () => {
  it('rejects resolve without the proxy token', async () => {
    const r = await app.request('/api/devices/loyalty/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'x.y' }) })
    expect(r.status).toBe(403)
  })
})

describe('QR is identity, backend is state', () => {
  it('token carries no balance snapshot', async () => {
    const g = await guest()
    const payload = JSON.parse(Buffer.from(g.card.card.split('.')[0], 'base64url').toString())
    expect(payload.p).toBeUndefined(); expect(payload.cb).toBeUndefined(); expect(payload.id).toBeTruthy()
  })

  it('reserves the free cup once, releases on expiry, consumes on SELL', async () => {
    const g = await guest()
    const cardId = (db.prepare('SELECT card_id FROM users WHERE card_code=?').get(g.card.cardCode) as any).card_id
    db.prepare('UPDATE cards SET paid_total=5 WHERE user_id=(SELECT id FROM users WHERE card_id=?)').run(cardId)

    const a = await resolve('dev-A', g.card.card)
    expect(a.status).toBe(200)
    expect(a.data.freeAvailable).toBe(1)
    expect(a.data.reservationId).toMatch(/^R-/)

    // second till with the same (old) QR: free is already reserved
    const b = await resolve('dev-B', g.card.card)
    expect(b.data.freeStatus).toBe('ALREADY_RESERVED')
    expect(b.data.reservationId).toBeNull()

    // reservation lapses (barista changed their mind) -> available again
    db.prepare(`UPDATE loyalty_reservations SET expires_at=1 WHERE id=?`).run(a.data.reservationId)
    const b2 = await resolve('dev-B', g.card.card)
    expect(b2.data.freeStatus).toBe('RESERVED')

    // dev-A's late sale with the expired reservation must not double-spend: B holds it, A's is EXPIRED -> still honoured once
    const sell = handleSell(db as any, 'store-1', doc('doc-1', { v: 2, c: g.card.card, op: b2.data.reservationId, free: 1, cb: 0, ts: 1 }))
    expect(sell.processed).toBe(true)
    const st = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=(SELECT id FROM users WHERE card_id=?)').get(cardId) as any
    expect(st.free_used).toBe(1)
    expect(st.paid_total).toBe(5) // the only cup was the free one

    // same QR again: nothing left
    const c = await resolve('dev-C', g.card.card)
    expect(c.data.freeAvailable).toBe(0)

    // replaying the same sale/old reservation gives nothing
    const sell2 = handleSell(db as any, 'store-1', doc('doc-2', { v: 2, c: g.card.card, op: a.data.reservationId, free: 1, cb: 0, ts: 1 }))
    expect(sell2.processed).toBe(true)
    const st2 = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=(SELECT id FROM users WHERE card_id=?)').get(cardId) as any
    expect(st2.free_used).toBe(1)
    expect(st2.paid_total).toBe(6)
  })

  it('manual numeric code never reserves or spends bonuses', async () => {
    const g = await guest()
    db.prepare('UPDATE cards SET paid_total=5 WHERE user_id=(SELECT id FROM users WHERE card_code=?)').run(g.card.cardCode)
    const r = await resolve('dev-A', g.card.cardCode)
    expect(r.data.kind).toBe('code')
    expect(r.data.freeAvailable).toBe(0)
    expect(r.data.reservationId).toBeNull()
  })

  it('does not leak other customers by code', async () => {
    const g = await guest()
    const r = await app.request(`/api/loyalty/card/${g.card.cardCode}`, { headers: { Authorization: `Bearer ${g.jwt}` } })
    expect(r.status).toBe(404)
  })
})

describe('referral aggregate and partial refund', () => {
  it('inviter gets 3% and sees only the aggregate; PAYBACK is proportional', async () => {
    const inviter = await guest()
    const inviteCode = (db.prepare('SELECT invite_code FROM users WHERE card_code=?').get(inviter.card.cardCode) as any).invite_code
    const friend = await guest(inviteCode)
    const sell = handleSell(db as any, 'store-1', doc('doc-ref', { v: 2, c: friend.card.card, op: null, ts: 1 }, 2, 1000))
    expect(sell.processed).toBe(true)
    const sync = await app.request('/api/sync', { method: 'POST', headers: { Authorization: `Bearer ${inviter.jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ receipts: [] }) })
    const me = (await sync.json() as any).me
    expect(me.fromFriendsRub).toBe(30)
    expect(me.cashbackBalance).toBe(3000)
    expect(me.friendsCount).toBe(1)

    // half refund -> half of cups and referral cashback reversed
    handlePayback(db as any, 'store-1', { id: 'pb-1', baseDocumentUUID: 'doc-ref', closeSum: 500 })
    const bal = db.prepare('SELECT cashback_balance FROM users WHERE card_code=?').get(inviter.card.cardCode) as any
    expect(bal.cashback_balance).toBe(1500)
    handlePayback(db as any, 'store-1', { id: 'pb-2', baseDocumentUUID: 'doc-ref', closeSum: 5000 })
    const bal2 = db.prepare('SELECT cashback_balance FROM users WHERE card_code=?').get(inviter.card.cardCode) as any
    expect(bal2.cashback_balance).toBe(0)
  })
})
