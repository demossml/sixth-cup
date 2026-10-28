/**
 * L-08: гостевая история показывает списание кэшбэка и сторно referral,
 * не подменяя сумму покупки и не дублируя SELL.
 */
import { describe, expect, it } from 'vitest'
import { app } from '../app'
import { db } from '../db'
import { config } from '../config'

const STORE = 'store-loy-history'
const COMMODITY = 'p-history-latte'

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`

/** Гость через реальный auth: JWT нужен для /api/sync/history. */
async function guest(): Promise<{ jwt: string; userId: number; cardId: string }> {
  const r = await app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const { token } = (await r.json()) as { token: string }
  const c = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  const card = (await c.json()) as { cardCode: string }
  const row = db.prepare('SELECT id, card_id AS cardId FROM users WHERE card_code=?').get(card.cardCode) as {
    id: number
    cardId: string
  }
  return { jwt: token, userId: row.id, cardId: row.cardId }
}

const history = async (jwt: string) => {
  const r = await app.request('/api/sync/history?limit=30', { headers: { Authorization: `Bearer ${jwt}` } })
  expect(r.status).toBe(200)
  return (await r.json()) as {
    items: {
      kind: string
      title: string
      cupsDelta: number
      freeDelta: number
      cashbackDeltaKop: number
      resultRub: number | null
      reason: string | null
      status: string
    }[]
  }
}

const insertOp = (store: string, docId: string, kind: 'SELL' | 'PAYBACK', cardId: string, o: { cb?: number; cups?: number; rub?: number }) =>
  db
    .prepare(
      `INSERT INTO loyalty_ops(doc_store,doc_id,kind,card_id,op_claimed,q_claimed,free,cb,disc_claimed,result_rub,cups_counted,created_at)
       VALUES(?,?,?,?,NULL,NULL,0,?,NULL,?,?,?)`,
    )
    .run(store, docId, kind, cardId, o.cb ?? 0, o.rub ?? 0, o.cups ?? 0, Date.now())

describe('L-08: прозрачность истории', () => {
  it('показывает покупку, списание кэшбэка и сумму чека отдельно', async () => {
    const g = await guest()
    insertOp(STORE, uniq('sell'), 'SELL', g.cardId, { cb: 5000, cups: 1, rub: 300 })

    const h = await history(g.jwt)
    const purchase = h.items.find((i) => i.kind === 'SELL')
    const spend = h.items.find((i) => i.kind === 'cashback_spend')

    expect(purchase).toBeTruthy()
    expect(purchase!.resultRub).toBe(300) // сумма покупки не подменена
    expect(spend).toBeTruthy()
    expect(spend!.cashbackDeltaKop).toBe(-5000) // списание видно отдельной строкой
    expect(spend!.title).toMatch(/Списано кэшбэком/)
  })

  it('показывает возврат кэшбэка при PAYBACK', async () => {
    const g = await guest()
    insertOp(STORE, uniq('sell'), 'SELL', g.cardId, { cb: 2000, cups: 1, rub: 300 })
    insertOp(STORE, uniq('payback'), 'PAYBACK', g.cardId, { cb: 2000, cups: 1, rub: 300 })

    const h = await history(g.jwt)
    const back = h.items.find((i) => i.kind === 'cashback_back')
    expect(back).toBeTruthy()
    expect(back!.cashbackDeltaKop).toBe(2000)
  })

  it('показывает отрицательное сторно referral отдельной строкой', async () => {
    const g = await guest()
    db.prepare(
      `INSERT INTO cashback_ledger(beneficiary_id,from_user_id,receipt_id,amount,created_at) VALUES(?,?,?,?,?)`,
    ).run(g.userId, g.userId, 'rec-credit', 300, Date.now() - 2000)
    db.prepare(
      `INSERT INTO cashback_ledger(beneficiary_id,from_user_id,receipt_id,amount,created_at) VALUES(?,?,?,?,?)`,
    ).run(g.userId, g.userId, 'rec-reversal', -300, Date.now())

    const h = await history(g.jwt)
    const rev = h.items.find((i) => i.kind === 'referral_reversal')
    expect(rev).toBeTruthy()
    expect(rev!.cashbackDeltaKop).toBe(-300)
    expect(rev!.title).toMatch(/Возврат кэшбэка/)
  })

  it('3.7: отдаёт freeDelta и reason, старые поля на месте', async () => {
    const g = await guest()
    // продажа с использованной бесплатной чашкой
    db.prepare(
      `INSERT INTO loyalty_ops(doc_store,doc_id,kind,card_id,op_claimed,q_claimed,free,cb,disc_claimed,result_rub,cups_counted,created_at)
       VALUES(?,?,'SELL',?,NULL,NULL,1,0,NULL,300,0,?)`,
    ).run(STORE, uniq('sell'), g.cardId, Date.now())

    const h = await history(g.jwt)
    const row = h.items.find((i) => i.kind === 'SELL') as any
    expect(row).toMatchObject({ cupsDelta: 0, freeDelta: -1, resultRub: 300, status: 'confirmed' })
    expect(row.reason).toBe('free_applied') // списание бесплатной объяснено
  })

  it('3.7: причина отсутствия начисления выводится из данных', async () => {
    const g = await guest()
    const noCups = uniq('sell')
    insertOp(STORE, noCups, 'SELL', g.cardId, { cups: 0, rub: 150 })

    const h = await history(g.jwt)
    const row = h.items.find((i) => i.kind === 'SELL') as any
    expect(row).toMatchObject({ cupsDelta: 0, freeDelta: 0 })
    expect(row.reason).toBe('no_cup_positions')
  })

  it('3.7: кламп бонуса помечается reason', async () => {
    const g = await guest()
    const docId = uniq('sell')
    insertOp(STORE, docId, 'SELL', g.cardId, { cups: 1, rub: 300 })
    db.prepare(`INSERT INTO disputes(kind,receipt_id,details,created_at) VALUES('loyalty_claim_clamped',?,?,?)`).run(
      docId,
      '{}',
      Date.now(),
    )

    const h = await history(g.jwt)
    const row = h.items.find((i) => i.kind === 'SELL') as any
    expect(row.reason).toBe('bonus_clamped')
  })

  it('не дублирует SELL строкой из loyalty_ledger', async () => {
    const g = await guest()
    const docId = uniq('sell')
    insertOp(STORE, docId, 'SELL', g.cardId, { cb: 0, cups: 2, rub: 400 })
    db.prepare(
      `INSERT INTO loyalty_ledger(card_id,operation,cups_delta,free_delta,cashback_delta,source_type,source_id,created_at)
       VALUES(?,'EARN',2,0,0,'EVOTOR_SELL',?,?)`,
    ).run(g.cardId, docId, Date.now())

    const h = await history(g.jwt)
    expect(h.items.filter((i) => i.kind === 'SELL')).toHaveLength(1)
  })
})
