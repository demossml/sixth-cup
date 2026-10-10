import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-poll-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { PollService } = await import('../integrations/evotor/sync/PollService')

const APP = '151071e8-88a4-44f6-b71a-b17c559f9b7d'
const COMMODITY = 'e4e11fb2-68d6-4a20-be08-279dec51e8f6'
const STORE = '20260929-0936-40D2-802D-CACB2BB08488'

let docs: Record<string, unknown>[] = []
const fakeClient = {
  isConfigured: true,
  getStores: async () => ({ items: [{ uuid: STORE, name: 'Мой магазин' }] }),
  getDocuments: async () => ({ items: docs }),
} as any

const sell = (uuid: string, extras: unknown) => ({
  uuid, type: 'SELL', closeDate: new Date().toISOString(), extras,
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: 15000, sum: 15000 }],
  closeSum: '15000.00',
})

async function setup() {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  const { token } = await r.json() as { token: string }
  await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  db.prepare("UPDATE users SET card_code='12' WHERE id=(SELECT user_id FROM cards ORDER BY user_id DESC LIMIT 1)").run()
  db.prepare(`INSERT INTO products(id,name,price,counts_as_cup) VALUES(500,'Американо',150,1)`).run()
  db.prepare(`INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(500,?,?)`).run(STORE, COMMODITY)
}

describe('PollService: Cloud document → loyalty (the path the owner is investigating)', () => {
  it('store without sync_enabled is not polled', async () => {
    await setup()
    const poll = new PollService(db, fakeClient)
    docs = [sell('d1', { [APP]: { sc: { v: 2, c: '0012', free: 0, cb: 0, ts: 1 } } })]
    const r = await poll.runFast()
    expect(r).toMatchObject({ stores: 0, inserted: 0, seen: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM loyalty_ops').get()).toEqual({ n: 0 })
  })

  it('enabled store: nested sc SELL is processed, counted, and not processed twice', async () => {
    db.prepare('UPDATE evotor_stores SET sync_enabled=1 WHERE store_uuid=?').run(STORE)
    const poll = new PollService(db, fakeClient)
    const r = await poll.runFast()
    expect(r).toMatchObject({ stores: 1, inserted: 1, seen: 1, sellSeen: 1 })
    expect(db.prepare("SELECT status FROM evotor_docs WHERE doc_id='d1'").get()).toEqual({ status: 'PROCESSED' })
    expect(db.prepare("SELECT cups_counted AS c, result_rub AS rub FROM loyalty_ops WHERE doc_id='d1'").get()).toEqual({ c: 1, rub: 150 })
    expect(db.prepare('SELECT paid_total AS p FROM cards ORDER BY user_id DESC LIMIT 1').get()).toEqual({ p: 1 })

    // next poll: the same document is returned again by Cloud (day-wide window) → known, no second credit
    const again = await poll.runFast()
    expect(again).toMatchObject({ inserted: 0, seen: 1, sellSeen: 1 })
    expect(db.prepare('SELECT paid_total AS p FROM cards ORDER BY user_id DESC LIMIT 1').get()).toEqual({ p: 1 })
  })

  it('SELL without sc is marked PROCESSED but never credited (skip), and shows up as seen', async () => {
    docs = [sell('d2', {})]
    const r = await new PollService(db, fakeClient).runFast()
    expect(r).toMatchObject({ inserted: 1, sellSeen: 1 })
    expect(db.prepare("SELECT status FROM evotor_docs WHERE doc_id='d2'").get()).toEqual({ status: 'PROCESSED' })
    expect(db.prepare("SELECT COUNT(*) AS n FROM loyalty_ops WHERE doc_id='d2'").get()).toEqual({ n: 0 })
  })

  it('empty Cloud answer: seen=0 (heartbeat can tell "Cloud has nothing" apart)', async () => {
    docs = []
    expect(await new PollService(db, fakeClient).runFast()).toMatchObject({ inserted: 0, seen: 0, sellSeen: 0 })
  })
})
