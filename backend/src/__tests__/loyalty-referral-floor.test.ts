/**
 * L-01: сторно referral пишется ровно на снятую сумму, баланс не уходит в минус,
 * недобор фиксируется спором `referral_reversal_shortfall`.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { handlePayback, handleSell } from '../integrations/evotor/processing/SellHandler'

const STORE = 'store-loy-floor'
const COMMODITY = 'p-floor-latte'

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`

type Person = { id: number; cardId: string; code: string }

function person(tag: string): Person {
  const code = String(4000 + ++seq)
  const t = Date.now()
  db.prepare(
    `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)`,
  ).run(`floor-${tag}-${code}`, `+70000${code}${tag.length}`, `FLOOR${code}`, `CARD-${code}`, code, t)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, t)
  return { id, cardId: `CARD-${code}`, code }
}

function invite(friend: Person, inviter: Person) {
  db.prepare('UPDATE users SET invited_by=? WHERE id=?').run(inviter.id, friend.id)
}

function sellDoc(docId: string, buyer: Person, sumKop: number) {
  return {
    uuid: docId,
    type: 'SELL',
    closeDate: new Date().toISOString(),
    extras: { sc: { v: 2, c: buyer.code, free: 0, cb: 0, ts: 1 } },
    transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: sumKop }],
    closeSum: String(sumKop),
  }
}

const bal = (id: number) =>
  Number((db.prepare('SELECT cashback_balance AS b FROM users WHERE id=?').get(id) as { b: number }).b)

const ledgerSum = (beneficiary: number) =>
  Number(
    (
      db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM cashback_ledger WHERE beneficiary_id=?').get(beneficiary) as {
        s: number
      }
    ).s,
  )

const shortfalls = (receiptId: string) =>
  db.prepare(`SELECT details FROM disputes WHERE kind='referral_reversal_shortfall' AND receipt_id=?`).all(receiptId) as {
    details: string
  }[]

beforeEach(() => {
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price) VALUES(950,'Latte',200)`).run()
  db.prepare(`INSERT OR IGNORE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(950,?,?)`).run(
    STORE,
    COMMODITY,
  )
})

describe('L-01: referral ledger совпадает с балансом', () => {
  it('пригласивший потратил бонус: ledger пишет только снятое, недобор — в спор', async () => {
    const inviter = person('inv')
    const friend = person('fr')
    invite(friend, inviter)

    const sellUuid = uniq('sell')
    const r = handleSell(db as any, STORE, sellDoc(sellUuid, friend, 100_000)) // 1000 ₽ → 3 % = 30 ₽
    expect(r.processed).toBe(true)
    const bonus = bal(inviter.id)
    expect(bonus).toBe(3000)

    // пригласивший потратил почти всё
    db.prepare('UPDATE users SET cashback_balance=500 WHERE id=?').run(inviter.id)

    const paybackUuid = uniq('payback')
    const pb = handlePayback(db as any, STORE, {
      uuid: paybackUuid,
      type: 'PAYBACK',
      baseDocumentUUID: sellUuid,
      closeDate: new Date().toISOString(),
      extras: { sc: { v: 2, c: friend.code, ts: 1 } },
      transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: 100_000 }],
      closeSum: '100000',
    })
    expect(pb.processed).toBe(true)

    // снято ровно 500 (сколько было), баланс не ушёл в минус
    expect(bal(inviter.id)).toBe(0)
    // Сторно в ledger — фактическое (−500), а не «идеальное» (−3000): фантомного долга нет.
    const reversals = db
      .prepare('SELECT amount FROM cashback_ledger WHERE beneficiary_id=? AND amount<0')
      .all(inviter.id) as { amount: number }[]
    expect(reversals).toEqual([{ amount: -500 }])
    expect(ledgerSum(inviter.id)).toBe(2500)

    const d = shortfalls(sellUuid)
    expect(d).toHaveLength(1)
    const details = JSON.parse(d[0].details) as { requested: number; actual: number; balance: number }
    expect(details).toMatchObject({ requested: 3000, actual: 500, balance: 500 })
  })

  it('бонус не тронут: сторно полное, спора нет', async () => {
    const inviter = person('inv2')
    const friend = person('fr2')
    invite(friend, inviter)

    const sellUuid = uniq('sell')
    handleSell(db as any, STORE, sellDoc(sellUuid, friend, 100_000))
    expect(bal(inviter.id)).toBe(3000)

    handlePayback(db as any, STORE, {
      uuid: uniq('payback'),
      type: 'PAYBACK',
      baseDocumentUUID: sellUuid,
      closeDate: new Date().toISOString(),
      extras: { sc: { v: 2, c: friend.code, ts: 1 } },
      transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: 100_000 }],
      closeSum: '100000',
    })

    expect(bal(inviter.id)).toBe(0)
    expect(ledgerSum(inviter.id)).toBe(0)
    expect(shortfalls(sellUuid)).toHaveLength(0)
  })
})
