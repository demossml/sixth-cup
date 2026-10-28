/**
 * 3.4: сбойный loyalty-чек сохраняет тело, виден в админке и переобрабатывается
 * без ручного SQL. Успешный повтор стирает raw; повтор обработанного безопасен.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app'
import { db } from '../db'
import { config } from '../config'
import { PollService } from '../integrations/evotor/sync/PollService'
import { createToken } from '../integrations/evotor/tokenStore'

const STORE = 'store-loy-failed'
const COMMODITY = 'p-failed-latte'
const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }

let docs: Record<string, unknown>[] = []
const fakeClient = {
  isConfigured: true,
  getStores: async () => ({ items: [{ uuid: STORE, name: 'Точка сбоев' }] }),
  getDocuments: async () => ({ items: docs }),
} as any

let seq = 0
let cards = 0
const uniq = (p: string) => `${p}-${++seq}`

function withCard(): string {
  const code = String(900 + ++cards)
  const t = Date.now()
  db.prepare(
    `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)`,
  ).run(`fail-${code}`, `+7400${code}`, `FAIL${code}`, `CARD-${code}`, code, t)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, t)
  return code
}

const sell = (uuid: string, code: string) => ({
  uuid,
  type: 'SELL',
  closeDate: new Date().toISOString(),
  extras: { sc: { v: 2, c: code, free: 0, cb: 0, ts: 1 } },
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: 30000 }],
  closeSum: '30000',
})

const row = (docId: string) =>
  db
    .prepare(`SELECT status, attempts, last_error AS lastError, raw_json AS raw, next_retry_at AS nextRetryAt FROM evotor_docs WHERE doc_id=?`)
    .get(docId) as { status: string; attempts: number; lastError: string | null; raw: string | null; nextRetryAt: number | null }

const api = async (m: string, p: string) => {
  const r = await app.request(`/api/admin${p}`, { method: m, headers: H })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any }
}

beforeEach(() => {
  docs = []
  createToken(db, { label: 'failed', token: 'failed-token', storeUuids: [STORE] })
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, sync_enabled, updated_at) VALUES(?,?,1,?)
     ON CONFLICT(store_uuid) DO UPDATE SET sync_enabled=1`,
  ).run(STORE, 'Точка сбоев', Date.now())
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,counts_as_cup) VALUES(980,'Latte',300,1)`).run()
  db.prepare(`INSERT OR IGNORE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(980,?,?)`).run(
    STORE,
    COMMODITY,
  )
})

const poll = () => new PollService(db, fakeClient).runFast()

describe('3.4: сбойные чеки и повтор', () => {
  it('сбой сохраняет тело и виден в списке FAILED', async () => {
    docs = [sell('fail-1', '000000')] // карты нет → сбой данных
    await poll()

    const r = row('fail-1')
    expect(r.status).toBe('FAILED')
    expect(r.raw).toBeTruthy()
    expect(JSON.parse(r.raw!).uuid).toBe('fail-1')

    const list = await api('GET', '/loyalty/failed')
    expect(list.status).toBe(200)
    const item = list.json.docs.find((d: any) => d.docId === 'fail-1')
    expect(item).toMatchObject({ hasRaw: 1, storeUuid: STORE, type: 'SELL' })
  })

  it('успешный повтор обрабатывает чек и стирает raw', async () => {
    const code = withCard()
    docs = [sell('fail-2', '000000')]
    await poll()
    expect(row('fail-2').status).toBe('FAILED')

    // гость «появился»: тот же документ, но с существующей картой
    docs = [sell('fail-2', code)]
    // админский повтор берёт сохранённый raw — поэтому подменим его на валидный,
    // как если бы APK прислал корректный чек
    db.prepare('UPDATE evotor_docs SET raw_json=? WHERE doc_id=?').run(JSON.stringify(sell('fail-2', code)), 'fail-2')

    const retry = await api('POST', `/loyalty/failed/fail-2/retry?storeUuid=${STORE}`)
    expect(retry.status).toBe(200)
    expect(retry.json).toMatchObject({ ok: true, status: 'PROCESSED' })

    const after = row('fail-2')
    expect(after.status).toBe('PROCESSED')
    expect(after.raw).toBeNull() // raw стёрт после успеха
    const op = db.prepare(`SELECT cups_counted AS cups FROM loyalty_ops WHERE doc_id='fail-2'`).get() as { cups: number }
    expect(op.cups).toBe(1)
  })

  it('повтор уже обработанного документа безопасен (duplicate)', async () => {
    const code = withCard()
    docs = [sell('fail-3', code)]
    await poll()
    expect(row('fail-3').status).toBe('PROCESSED')

    const retry = await api('POST', `/loyalty/failed/fail-3/retry?storeUuid=${STORE}`)
    expect(retry.status).toBe(200)
    expect(retry.json.status).toBe('PROCESSED')
    const ops = db.prepare(`SELECT COUNT(*) AS n FROM loyalty_ops WHERE doc_id='fail-3'`).get() as { n: number }
    expect(ops.n).toBe(1) // второго начисления нет
  })

  it('без storeUuid → 400, неизвестный документ → 404', async () => {
    expect((await api('POST', '/loyalty/failed/fail-3/retry')).status).toBe(400)
    expect((await api('POST', `/loyalty/failed/nope/retry?storeUuid=${STORE}`)).status).toBe(404)
  })
})
