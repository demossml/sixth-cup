/**
 * Блок C: реферал 3% — начисление, отсутствие начисления, идемпотентность,
 * сторно при возврате, контракт истории и построчная детализация в карточке клиента.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-refacc-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { config } = await import('../config')
const { ensureCard, buildCardProof } = await import('../modules/loyalty/proof')
const { handleSell, handlePayback } = await import('../integrations/evotor/processing/SellHandler')

const STORE = 'store-refacc'
const COMMODITY = 'p-refacc-latte'
const APP = '151071e8-88a4-44f6-b71a-b17c559f9b7d'
const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`

function person(tag: string, inviterId?: number): { id: number; code: string; proof: string } {
  const code = String(6000 + ++seq)
  const t = Date.now()
  db.prepare(
    `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at, invited_by) VALUES(?,?,?,?,?,?,?)`,
  ).run(`ref-${tag}-${code}`, `+7600${code}`, `REF${code}`, `CARD-${code}`, code, t, inviterId ?? null)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  ensureCard(id)
  return { id, code, proof: buildCardProof(id) }
}

const sell = (docId: string, code: string, priceKop = 100_000) => ({
  uuid: docId,
  type: 'SELL',
  closeDate: new Date().toISOString(),
  extras: { [APP]: { sc: { v: 2, c: code, free: 0, cb: 0, ts: 1 } } },
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: priceKop }],
  closeSum: String(priceKop),
})

const balance = (userId: number) =>
  Number((db.prepare('SELECT cashback_balance AS b FROM users WHERE id=?').get(userId) as { b: number }).b)

const ledgerRows = (userId: number) =>
  db
    .prepare('SELECT amount, receipt_id AS receiptId FROM cashback_ledger WHERE beneficiary_id=? ORDER BY id')
    .all(userId) as { amount: number; receiptId: string }[]

beforeEach(() => {
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,counts_as_cup) VALUES(940,'Latte',1000,1)`).run()
  db.prepare(`INSERT OR IGNORE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(940,?,?)`).run(
    STORE,
    COMMODITY,
  )
})

describe('C1: начисление реферала', () => {
  it('покупка приглашённого даёт пригласившему 3%', () => {
    const inviter = person('inv')
    const friend = person('fr', inviter.id)
    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, friend.proof))

    expect(balance(inviter.id)).toBe(3000) // 1000 ₽ → 30 ₽
    expect(ledgerRows(inviter.id)).toEqual([{ amount: 3000, receiptId: docId }])
  })

  it('без invited_by начисления нет', () => {
    const lonely = person('solo')
    handleSell(db as any, STORE, sell(uniq('sell'), lonely.proof))
    expect(balance(lonely.id)).toBe(0)
    expect(ledgerRows(lonely.id)).toHaveLength(0)
  })

  it('повторная обработка того же документа не начисляет второй раз', () => {
    const inviter = person('inv2')
    const friend = person('fr2', inviter.id)
    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, friend.proof))
    handleSell(db as any, STORE, sell(docId, friend.proof)) // duplicate
    expect(balance(inviter.id)).toBe(3000)
    expect(ledgerRows(inviter.id)).toHaveLength(1)
  })

  it('использованный кэшбэк уменьшает базу процента', async () => {
    const { resolveAndReserve } = await import('../modules/loyalty/reservations')
    const inviter = person('inv3')
    const friend = person('fr3', inviter.id)
    db.prepare('UPDATE users SET cashback_balance=20000 WHERE id=?').run(friend.id)
    // без резерва кэшбэк не списывается — берём signed QR, как на кассе
    const r = resolveAndReserve({ code: friend.proof, storeUuid: STORE, deviceUuid: 'dev-c3' })
    expect(r.ok).toBe(true)

    const docId = uniq('sell')
    const doc = sell(docId, friend.proof)
    ;(doc.extras as any)[APP].sc.cb = 5000 // гость списал 50 ₽ кэшбэка
    ;(doc.extras as any)[APP].sc.op = (r as any).reservationId
    handleSell(db as any, STORE, doc)

    // база = 1000 − 50 = 950 ₽ → 3% = 28,50 → floor 28,50 ₽ = 2850 коп.
    expect(balance(inviter.id)).toBe(2850)
  })

  it('PAYBACK сторнирует реферальное начисление в пределах баланса', () => {
    const inviter = person('inv4')
    const friend = person('fr4', inviter.id)
    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, friend.proof))
    expect(balance(inviter.id)).toBe(3000)

    handlePayback(db as any, STORE, {
      uuid: uniq('payback'),
      type: 'PAYBACK',
      baseDocumentUUID: docId,
      closeDate: new Date().toISOString(),
      extras: { [APP]: { sc: { v: 2, c: friend.proof, ts: 1 } } },
      transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: 100_000 }],
      closeSum: '100000',
    })

    expect(balance(inviter.id)).toBe(0)
    expect(ledgerRows(inviter.id).at(-1)).toMatchObject({ amount: -3000 })
  })
})

describe('C2: контракт истории', () => {
  it('после покупки друга пригласивший видит строку referral', async () => {
    // пригласивший — реальный гость PWA: нужен его JWT
    const gr = await app.request('/api/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const { token } = (await gr.json()) as { token: string }
    const cardRes = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
    const myCard = (await cardRes.json()) as { cardCode: string }
    const inviterId = Number(
      (db.prepare('SELECT id FROM users WHERE card_code=?').get(myCard.cardCode) as { id: number }).id,
    )

    const friend = person('fr5', inviterId)
    handleSell(db as any, STORE, sell(uniq('sell'), friend.proof))

    const r = await app.request('/api/sync/history?limit=30', { headers: { Authorization: `Bearer ${token}` } })
    expect(r.status).toBe(200)
    const j = (await r.json()) as { items: { kind: string; title: string; cashbackDeltaKop: number }[] }
    const row = j.items.find((i) => i.kind === 'referral')
    expect(row).toMatchObject({ title: 'Кэшбэк от покупок друга', cashbackDeltaKop: 3000 })
  })
})

describe('C3: карточка клиента в админке', () => {
  it('показывает построчные начисления с источником', async () => {
    const inviter = person('inv6')
    const friend = person('fr6', inviter.id)
    handleSell(db as any, STORE, sell(uniq('sell'), friend.proof))
    // игровая награда для проверки разделения источника
    db.prepare('INSERT INTO cashback_ledger(beneficiary_id,from_user_id,receipt_id,amount,created_at) VALUES(?,?,?,?,?)').run(
      inviter.id,
      inviter.id,
      `game:${uniq('session')}`,
      500,
      Date.now(),
    )

    const r = await app.request(`/api/admin/customers/${inviter.id}`, { headers: H })
    expect(r.status).toBe(200)
    const j = (await r.json()) as { cashback: { amount: number; source: string; receiptId: string }[] }
    expect(j.cashback).toHaveLength(2)
    const sources = j.cashback.map((c) => c.source).sort()
    expect(sources).toEqual(['game', 'referral'])
    expect(j.cashback.find((c) => c.source === 'referral')?.amount).toBe(3000)
    expect(j.cashback.find((c) => c.source === 'game')?.amount).toBe(500)
  })
})
