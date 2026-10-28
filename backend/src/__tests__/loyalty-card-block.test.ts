/**
 * 3.6: стоп-лист карт — блокировка/разблокировка через админку, отказ в resolve и в handleSell,
 * запись в аудит. Ключ — строковый card_id.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

// env должен быть выставлен до импорта config/app — иначе resolve ответит 503
const dir = mkdtempSync(join(tmpdir(), 'sc-block-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { config } = await import('../config')
const { handleSell } = await import('../integrations/evotor/processing/SellHandler')

const STORE = 'store-loy-block'
const COMMODITY = 'p-block-latte'
const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const PROXY = { ...H, Authorization: 'proxy-secret', 'X-Evotor-Store-Uuid': STORE, 'X-Evotor-Device-UUID': 'dev-blk' }

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`

async function guest(): Promise<{ cardId: string; cardProof: string; code: string }> {
  const r = await app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const { token } = (await r.json()) as { token: string }
  const c = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  const card = (await c.json()) as { cardCode: string; card: string }
  const row = db.prepare('SELECT card_id AS cardId FROM users WHERE card_code=?').get(card.cardCode) as { cardId: string }
  return { cardId: row.cardId, cardProof: card.card, code: card.cardCode }
}

const api = async (m: string, p: string, body?: unknown) => {
  const r = await app.request(`/api/admin${p}`, { method: m, headers: H, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any }
}

const resolve = async (code: string) => {
  const r = await app.request('/api/devices/loyalty/resolve', {
    method: 'POST',
    headers: PROXY,
    body: JSON.stringify({ code }),
  })
  return { status: r.status, json: (await r.json()) as any }
}

const sell = (uuid: string, code: string) => ({
  uuid,
  type: 'SELL',
  closeDate: new Date().toISOString(),
  extras: { sc: { v: 2, c: code, free: 0, cb: 0, ts: 1 } },
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: 30000 }],
  closeSum: '30000',
})

beforeEach(() => {
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,counts_as_cup) VALUES(990,'Latte',300,1)`).run()
  db.prepare(`INSERT OR IGNORE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(990,?,?)`).run(
    STORE,
    COMMODITY,
  )
})

describe('3.6: стоп-лист карт', () => {
  it('блокировка: resolve отказывает, handleSell не начисляет', async () => {
    const g = await guest()
    const block = await api('POST', `/cards/${g.cardId}/block`, { reason: 'подозрение на фрод' })
    expect(block.status).toBe(200)
    expect(block.json).toMatchObject({ blocked: true, cardId: g.cardId })

    const r = await resolve(g.cardProof)
    // контракт resolve: любая ошибка карты отдаётся как 404 с полем error
    expect(r.status).toBe(404)
    expect(r.json).toMatchObject({ ok: false, error: 'card_blocked' })

    // прямой путь: чек через poll (handleSell)
    const res = handleSell(db as any, STORE, sell(uniq('sell'), g.code))
    expect(res).toMatchObject({ processed: false, reason: 'card blocked' })
    const ops = db.prepare(`SELECT COUNT(*) AS n FROM loyalty_ops WHERE card_id=?`).get(g.cardId) as { n: number }
    expect(ops.n).toBe(0)
    const disputes = db.prepare(`SELECT kind FROM disputes WHERE kind='card_blocked'`).all() as { kind: string }[]
    expect(disputes.length).toBeGreaterThan(0)
  })

  it('разблокировка возвращает работу', async () => {
    const g = await guest()
    await api('POST', `/cards/${g.cardId}/block`, { reason: 'проверка' })
    const un = await api('DELETE', `/cards/${g.cardId}/block`)
    expect(un.status).toBe(200)
    expect(un.json).toMatchObject({ blocked: false })

    const r = await resolve(g.cardProof)
    expect(r.json.ok).toBe(true)

    expect(handleSell(db as any, STORE, sell(uniq('sell'), g.code))).toMatchObject({ processed: true })
  })

  it('причина обязательна, повторная блокировка идемпотентна', async () => {
    const g = await guest()
    expect((await api('POST', `/cards/${g.cardId}/block`, { reason: 'ok' })).status).toBe(400)

    expect((await api('POST', `/cards/${g.cardId}/block`, { reason: 'первая причина' })).status).toBe(200)
    expect((await api('POST', `/cards/${g.cardId}/block`, { reason: 'вторая причина' })).status).toBe(200)
    const rows = db.prepare('SELECT reason FROM card_denylist WHERE card_id=?').all(g.cardId) as { reason: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe('вторая причина') // обновление, а не дубль
  })

  it('разблокировка незаблокированной карты → 404', async () => {
    const g = await guest()
    expect((await api('DELETE', `/cards/${g.cardId}/block`)).status).toBe(404)
  })

  it('аудит пишет блокировку и разблокировку', async () => {
    const g = await guest()
    await api('POST', `/cards/${g.cardId}/block`, { reason: 'аудит-тест' })
    await api('DELETE', `/cards/${g.cardId}/block`)

    const rows = db
      .prepare(`SELECT summary FROM admin_audit WHERE entity='cards' AND entity_id=? ORDER BY id`)
      .all(g.cardId) as { summary: string }[]
    expect(rows.map((r) => r.summary)).toEqual([
      expect.stringContaining('Карта заблокирована'),
      expect.stringContaining('Карта разблокирована'),
    ])
  })
})
