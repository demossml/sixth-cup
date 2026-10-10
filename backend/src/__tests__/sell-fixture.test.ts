import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-sell-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { handleSell } = await import('../integrations/evotor/processing/SellHandler')

const APP = '151071e8-88a4-44f6-b71a-b17c559f9b7d'
const COMMODITY = 'e4e11fb2-68d6-4a20-be08-279dec51e8f6'
const STORE = '20260929-0936-40D2-802D-CACB2BB08488'
const admin = { 'Content-Type': 'application/json', 'X-Admin-Token': 'test-admin' }

// the ТЗ fixture, verbatim
const fixture = () => ({
  uuid: 'f22cb7a7-ab0d-4b53-a0ef-a0095d35866f',
  type: 'SELL',
  extras: { [APP]: { sc: { v: 2, c: '0012', free: 0, cb: 0, ts: 1 } } },
  transactions: [
    { type: 'REGISTER_POSITION', commodityUuid: COMMODITY, commodityName: 'Американо', quantity: 2, price: 15000, sum: 30000 },
  ],
  closeSum: '30000.00',
})

async function guest() {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  const { token } = await r.json() as { token: string }
  await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  return token
}

const userId = (code: string) => (db.prepare('SELECT id FROM users WHERE card_code=?').get(code) as { id: number }).id
const paid = (uid: number) => (db.prepare('SELECT paid_total FROM cards WHERE user_id=?').get(uid) as { paid_total: number }).paid_total

describe('Evotor SELL fixture → loyalty', () => {
  it('counts cups via product_store_links + commodityUuid, nested sc, uuid id, "0012" card code', async () => {
    const jwt = await guest()
    db.prepare("UPDATE users SET card_code='12' WHERE id=(SELECT user_id FROM cards ORDER BY user_id DESC LIMIT 1)").run()
    const uid = userId('12')
    expect(jwt).toBeTruthy()

    // product created through the admin API: a drink gets counts_as_cup by default
    const created = await app.request('/api/admin/products', { method: 'POST', headers: admin, body: JSON.stringify({ name: 'Американо', price: 150 }) })
    expect(created.status).toBe(200)
    const { id } = await created.json() as { id: number }
    expect(Number.isInteger(id) && id > 0).toBe(true) // regression: was NaN for new products
    expect((db.prepare('SELECT counts_as_cup AS c FROM products WHERE id=?').get(id) as { c: number }).c).toBe(1)
    db.prepare(`INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(?,?,?)`).run(id, STORE, COMMODITY)

    const res = handleSell(db, STORE, fixture())
    expect(res).toEqual({ processed: true })

    const op = db.prepare('SELECT doc_id, cups_counted, result_rub, kind FROM loyalty_ops WHERE doc_store=?').get(STORE) as any
    expect(op).toMatchObject({ doc_id: 'f22cb7a7-ab0d-4b53-a0ef-a0095d35866f', cups_counted: 2, result_rub: 300, kind: 'SELL' })
    expect(paid(uid)).toBe(2)

    // idempotent: the same document never credits twice
    expect(handleSell(db, STORE, fixture())).toEqual({ processed: true, reason: 'duplicate' })
    expect(paid(uid)).toBe(2)
  })

  it('counts_as_cup=0 → no cups; unknown commodity → no cups', () => {
    const uid = userId('12')
    db.prepare('UPDATE products SET counts_as_cup=0 WHERE id=(SELECT product_id FROM product_store_links WHERE evotor_uuid=?)').run(COMMODITY)
    const d = { ...fixture(), uuid: 'doc-2' }
    expect(handleSell(db, STORE, d).processed).toBe(true)
    expect((db.prepare("SELECT cups_counted AS c FROM loyalty_ops WHERE doc_id='doc-2'").get() as any).c).toBe(0)
    const d3 = { ...fixture(), uuid: 'doc-3', transactions: [{ type: 'REGISTER_POSITION', commodityUuid: 'unknown', quantity: 1, price: 100 }] }
    handleSell(db, STORE, d3)
    expect((db.prepare("SELECT cups_counted AS c FROM loyalty_ops WHERE doc_id='doc-3'").get() as any).c).toBe(0)
    expect(paid(uid)).toBe(2)
  })

  it('unknown card and a document without loyalty extra are not credited', () => {
    const bad = { ...fixture(), uuid: 'doc-4', extras: { [APP]: { sc: { v: 2, c: '9999', free: 0, cb: 0, ts: 1 } } } }
    expect(handleSell(db, STORE, bad)).toMatchObject({ processed: false, reason: 'card code not found' })
    expect(handleSell(db, STORE, { ...fixture(), uuid: 'doc-5', extras: {} })).toMatchObject({ processed: false, reason: 'no loyalty extra' })
    expect(handleSell(db, STORE, { ...fixture(), uuid: undefined, id: undefined } as any)).toMatchObject({ reason: 'missing document id' })
  })

  it('admin: ops list and sales summary use the real tables', async () => {
    const ops = await (await app.request('/api/admin/loyalty/ops?limit=10', { headers: admin })).json() as any
    expect(ops.ops.find((o: any) => o.docId === 'f22cb7a7')).toMatchObject({ cardCode: '12', cups: 2, kind: 'SELL', storeUuid: '20260929' })
    db.prepare(`INSERT INTO evotor_docs(store_uuid,doc_id,type,close_date_ms,source,status,received_at) VALUES(?,?,?,?,?,?,?)`)
      .run(STORE, 'f22cb7a7-x', 'SELL', Date.now(), 'poll', 'PROCESSED', Date.now())
    db.prepare(`INSERT INTO evotor_sync_state(store_uuid,last_fast_at) VALUES(?,?)`).run(STORE, 1_700_000_000_000)
    const sum = await (await app.request('/api/admin/sales/summary', { headers: admin })).json() as any
    expect(sum.sellDocs).toBe(1)
    expect(sum.lastPollAt).toBe(1_700_000_000_000)
    expect(sum.loyalty.ops).toBeGreaterThanOrEqual(1)
    expect(sum.loyalty.cups).toBeGreaterThanOrEqual(2)
  })

  it('state seen by the PWA reflects the credited cups', async () => {
    const jwt = await guest()
    const uid = (db.prepare('SELECT user_id AS id FROM cards ORDER BY user_id DESC LIMIT 1').get() as { id: number }).id
    db.prepare("UPDATE users SET card_code='77' WHERE id=?").run(uid)
    db.prepare('UPDATE cards SET paid_total=7 WHERE user_id=?').run(uid)
    const r = await app.request('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify({ receipts: [] }) })
    const body = await r.json() as any
    expect(body.me).toMatchObject({ cupsTowardFree: 2, freeAvailable: 1, cupsForFree: 5, cardCode: '77' })
  })
})
