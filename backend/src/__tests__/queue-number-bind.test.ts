import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-qbind-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const { handleSell, sellInternals } = await import('../integrations/evotor/processing/SellHandler')
const { issueQueueNumber, findQueueNumber } = await import('../modules/queue/numbers')

const STORE = 'store-qbind'
const APP = '151071e8-88a4-44f6-b71a-b17c559f9b7d'

/** Чек: одна чашка, карта по короткому коду, extras — как пишет APK. */
function doc(id: string, sc: Record<string, unknown>) {
  return {
    uuid: id,
    fiscalDocumentNumber: 'FD-777',
    extras: { [APP]: { sc } },
    closeSum: 20000,
    transactions: [{ type: 'REGISTER_POSITION', productUuid: 'p-latte', quantity: 1 }],
  }
}

async function guest() {
  const r = await (await import('../app')).app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const j = (await r.json()) as { token: string }
  const me = (await (
    await (await import('../app')).app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${j.token}` } })
  ).json()) as { cardCode: string }
  return me.cardCode
}

describe('queue number binding via extras.sc.ord', () => {
  beforeAll(() => {
    db.prepare(`INSERT INTO products(id,name,price) VALUES(900,'Latte',200)`).run()
    db.prepare('UPDATE products SET counts_as_cup=1 WHERE id=900').run()
    db.prepare(`INSERT INTO evotor_products(product_id,variant,store_uuid,evotor_uuid) VALUES(900,'',?,'p-latte')`).run(STORE)
  })

  it('parses ord and qn from flat, nested and JSON-string extras', () => {
    const flat = sellInternals.getSc({ extras: { sc: { v: 2, c: '0012', ord: 'ord-1', qn: '47' } } })
    expect(flat?.ord).toBe('ord-1')
    expect(flat?.qn).toBe('47')

    const nested = sellInternals.getSc({ extras: { [APP]: { sc: { v: 2, c: '0012', ord: 'ord-2' } } } })
    expect(nested?.ord).toBe('ord-2')

    const asString = sellInternals.getSc({ extras: { sc: JSON.stringify({ v: 2, c: '0012', ord: 'ord-3', qn: '7' }) } })
    expect(asString?.ord).toBe('ord-3')
  })

  it('trims and drops empty ord', () => {
    const sc = sellInternals.getSc({ extras: { sc: { v: 2, c: '0012', ord: '   ', qn: '' } } })
    expect(sc?.ord).toBeUndefined()
    expect(sc?.qn).toBeUndefined()
  })

  it('binds the evotor document to the issued queue number', async () => {
    const code = await guest()
    const issued = issueQueueNumber({ storeUuid: STORE })
    const res = handleSell(db as any, STORE, doc('doc-bind-1', { v: 2, c: code, ord: issued.orderId, qn: String(issued.number) }))
    expect(res.processed).toBe(true)

    const row = db.prepare('SELECT status, evotor_document_uuid, fiscal_document_number, number FROM queue_numbers WHERE order_id=?')
      .get(issued.orderId) as any
    expect(row.status).toBe('BOUND')
    expect(row.evotor_document_uuid).toBe('doc-bind-1')
    expect(row.fiscal_document_number).toBe('FD-777')
    expect(row.number).toBe(issued.number)
  })

  it('loyalty still works when ord is absent (old receipts)', async () => {
    const code = await guest()
    const res = handleSell(db as any, STORE, doc('doc-nord-1', { v: 2, c: code }))
    expect(res.processed).toBe(true)
    const op = db.prepare(`SELECT cups_counted FROM loyalty_ops WHERE doc_store=? AND doc_id='doc-nord-1'`).get(STORE) as any
    expect(op.cups_counted).toBe(1)
  })

  it('unknown ord does not break loyalty', async () => {
    const code = await guest()
    const res = handleSell(db as any, STORE, doc('doc-unknown-ord', { v: 2, c: code, ord: 'order-does-not-exist' }))
    expect(res.processed).toBe(true)
    expect(findQueueNumber('order-does-not-exist')).toBeNull()
    const op = db.prepare(`SELECT 1 AS ok FROM loyalty_ops WHERE doc_id='doc-unknown-ord'`).get() as any
    expect(op.ok).toBe(1)
  })

  it('repeated poll keeps the link and does not duplicate loyalty', async () => {
    const code = await guest()
    const issued = issueQueueNumber({ storeUuid: STORE })
    const first = handleSell(db as any, STORE, doc('doc-repeat-1', { v: 2, c: code, ord: issued.orderId }))
    expect(first.processed).toBe(true)
    const second = handleSell(db as any, STORE, doc('doc-repeat-1', { v: 2, c: code, ord: issued.orderId }))
    expect(second.reason).toBe('duplicate')

    const ops = db.prepare(`SELECT COUNT(*) AS n FROM loyalty_ops WHERE doc_id='doc-repeat-1'`).get() as { n: number }
    expect(ops.n).toBe(1)
    const row = db.prepare('SELECT status FROM queue_numbers WHERE order_id=?').get(issued.orderId) as any
    expect(row.status).toBe('BOUND')
  })

  it('cancelled number is not resurrected by a late SELL', async () => {
    const code = await guest()
    const issued = issueQueueNumber({ storeUuid: STORE })
    db.prepare(`UPDATE queue_numbers SET status='CANCELLED' WHERE order_id=?`).run(issued.orderId)
    const res = handleSell(db as any, STORE, doc('doc-late-1', { v: 2, c: code, ord: issued.orderId }))
    expect(res.processed).toBe(true)
    const row = db.prepare('SELECT status FROM queue_numbers WHERE order_id=?').get(issued.orderId) as any
    expect(row.status).toBe('CANCELLED')
  })
})
