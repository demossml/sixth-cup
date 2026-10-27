import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-queue-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-token'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { MAX_NUMBER, bindQueueNumber, cancelQueueNumber, issueQueueNumber, listQueueNumbers, periodKeyOf } =
  await import('../modules/queue/numbers')

const STORE = 'store-queue-1'
const DAY = new Date('2026-10-27T10:00:00+05:00').getTime()

async function issue(body: Record<string, unknown> = {}) {
  const r = await app.request('/api/devices/queue-number', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer proxy-token', 'X-Evotor-Store-Uuid': STORE },
    body: JSON.stringify(body),
  })
  return { status: r.status, json: (await r.json()) as any }
}

describe('queue numbers', () => {
  beforeAll(() => {
    db.prepare('DELETE FROM queue_numbers').run()
    db.prepare('DELETE FROM queue_counters').run()
  })

  it('issues sequential numbers per store and day', () => {
    const a = issueQueueNumber({ storeUuid: STORE, now: DAY })
    const b = issueQueueNumber({ storeUuid: STORE, now: DAY })
    const c = issueQueueNumber({ storeUuid: STORE, now: DAY })
    expect([a.number, b.number, c.number]).toEqual([1, 2, 3])
    expect(a.periodKey).toBe(periodKeyOf(DAY))
  })

  it('keeps stores independent', () => {
    const other = issueQueueNumber({ storeUuid: 'store-queue-2', now: DAY })
    expect(other.number).toBe(1)
  })

  it('reuses the number for the same order id (idempotent)', () => {
    const first = issueQueueNumber({ storeUuid: STORE, orderId: 'order-fixed-1', now: DAY })
    const again = issueQueueNumber({ storeUuid: STORE, orderId: 'order-fixed-1', now: DAY })
    expect(again.number).toBe(first.number)
    expect(again.orderId).toBe(first.orderId)
    const rows = db.prepare('SELECT COUNT(*) AS n FROM queue_numbers WHERE order_id=?').get('order-fixed-1') as { n: number }
    expect(rows.n).toBe(1)
  })

  it('starts from 1 again on a new day', () => {
    const nextDay = DAY + 24 * 60 * 60 * 1000
    const n = issueQueueNumber({ storeUuid: 'store-queue-day', now: DAY })
    const next = issueQueueNumber({ storeUuid: 'store-queue-day', now: nextDay })
    expect(n.number).toBe(1)
    expect(next.number).toBe(1)
    expect(next.periodKey).not.toBe(n.periodKey)
  })

  it('never hands out a number that is still active', () => {
    // Занимаем 4 и 5 вручную, счётчик уже на 3.
    const store = 'store-queue-skip'
    issueQueueNumber({ storeUuid: store, now: DAY }) // 1
    issueQueueNumber({ storeUuid: store, now: DAY }) // 2
    db.prepare(`INSERT INTO queue_numbers(order_id, store_uuid, period_key, number, status, created_at)
                VALUES('manual-4',?,?,?, 'ISSUED', ?)`)
      .run(store, periodKeyOf(DAY), 4, DAY)
    const third = issueQueueNumber({ storeUuid: store, now: DAY })
    expect(third.number).toBe(3)
    expect(third.number).not.toBe(4)
  })

  it('wraps around after the maximum instead of breaking the sale', () => {
    const store = 'store-queue-wrap'
    const period = periodKeyOf(DAY)
    db.prepare('INSERT INTO queue_counters(store_uuid, period_key, last_number) VALUES(?,?,?)').run(store, period, MAX_NUMBER)
    const n = issueQueueNumber({ storeUuid: store, now: DAY })
    expect(n.number).toBe(1)
    expect(n.number).toBeLessThanOrEqual(MAX_NUMBER)
  })

  it('cancelled number is free again, bound keeps working', () => {
    const store = 'store-queue-cancel'
    const a = issueQueueNumber({ storeUuid: store, now: DAY })
    expect(cancelQueueNumber(a.orderId, DAY)).toBe(true)
    const rows = listQueueNumbers(store, periodKeyOf(DAY))
    expect(rows.find((r) => r.orderId === a.orderId)?.status).toBe('CANCELLED')
  })

  it('binds the evotor document without changing the number', () => {
    const store = 'store-queue-bind'
    const a = issueQueueNumber({ storeUuid: store, now: DAY })
    expect(bindQueueNumber(a.orderId, { evotorDocumentUuid: 'doc-1', fiscalDocumentNumber: '123' }, DAY)).toBe(true)
    const row = db.prepare('SELECT number, status, evotor_document_uuid, fiscal_document_number FROM queue_numbers WHERE order_id=?')
      .get(a.orderId) as any
    expect(row.number).toBe(a.number)
    expect(row.status).toBe('BOUND')
    expect(row.evotor_document_uuid).toBe('doc-1')
    expect(row.fiscal_document_number).toBe('123')
  })

  it('number is never the evotor document or fiscal number', () => {
    const store = 'store-queue-notfiscal'
    const a = issueQueueNumber({ storeUuid: store, now: DAY })
    bindQueueNumber(a.orderId, { evotorDocumentUuid: 'uuid-should-not-be-number', fiscalDocumentNumber: '777777' }, DAY)
    expect(String(a.number)).not.toBe('777777')
    expect(a.number).toBeLessThanOrEqual(MAX_NUMBER)
  })

  it('http endpoint requires the store and returns the public number as a string', async () => {
    const ok = await issue({ orderId: 'http-order-1' })
    expect(ok.status).toBe(200)
    expect(ok.json.ok).toBe(true)
    expect(typeof ok.json.publicOrderNumber).toBe('string')
    expect(ok.json.orderId).toBe('http-order-1')

    const repeated = await issue({ orderId: 'http-order-1' })
    expect(repeated.json.publicOrderNumber).toBe(ok.json.publicOrderNumber)

    const noStore = await app.request('/api/devices/queue-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer proxy-token' },
      body: JSON.stringify({}),
    })
    expect(noStore.status).toBe(400)
  })
})
