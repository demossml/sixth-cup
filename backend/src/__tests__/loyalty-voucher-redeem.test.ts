/**
 * L-06: погашение ваучера атомарно. Два чека с одним ваучером не могут оба его погасить:
 * успех только при changes === 1, проигравший уходит в disputes.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { applyReceipts } from '../modules/loyalty/receipts'
import { grantVoucher } from '../modules/vouchers/service'
import { ed25519 } from '@noble/curves/ed25519'
import { b64u } from '../lib/crypto'

let seq = 0
let receiptQ = Math.floor(Date.now() / 1000)
const uniq = (p: string) => `${p}-${++seq}`

/** Устройство с собственным ключом: подписываем чек тем же ключом, что лежит в БД. */
function deviceWithKey() {
  const priv = ed25519.utils.randomPrivateKey()
  const pub = ed25519.getPublicKey(priv)
  const t = Date.now()
  db.prepare(`INSERT OR IGNORE INTO stores(id, name, address) VALUES(1,'Точка теста','Тестовый адрес')`).run()
  const info = db
    .prepare(`INSERT INTO devices(store_id, name, public_key, revoked, created_at) VALUES(1,?,?,0,?)`)
    .run(`dev-${++seq}`, b64u.enc(pub), t)
  const id = Number(info.lastInsertRowid)
  return { id, priv }
}

function userWithCard(): { id: number; cardId: string; code: string } {
  const code = String(3000 + ++seq)
  const t = Date.now()
  db.prepare(
    `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)`,
  ).run(`vou-${code}`, `+7100${code}`, `VOU${code}`, `CARD-${code}`, code, t)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, t)
  return { id, cardId: `CARD-${code}`, code }
}

function receiptToken(priv: Uint8Array, dev: number, user: number, receiptId: string, vouchers: number[]) {
  const payload = {
    t: 'r',
    r: receiptId,
    u: user,
    d: dev,
    q: (receiptQ += 2), // после чека cards.seq = q+1, поэтому шаг 2
    p: 0,
    f: 0,
    v: [],
    cb: 0,
    dp: 0,
    df: 0,
    dcb: 0,
    vu: vouchers,
    a: 0,
    ts: Math.floor(Date.now() / 1000),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  return `${b64u.enc(bytes)}.${b64u.enc(ed25519.sign(bytes, priv))}`
}

const voucherRow = (id: number) =>
  db.prepare('SELECT used_at AS usedAt, receipt_id AS receiptId FROM vouchers WHERE id=?').get(id) as {
    usedAt: number | null
    receiptId: string | null
  }

const disputesFor = (receiptId: string) =>
  db.prepare('SELECT kind FROM disputes WHERE receipt_id=?').all(receiptId) as { kind: string }[]

beforeEach(() => {
  // шаблон WELCOME нужен grantVoucher
  db.prepare(
    `INSERT OR IGNORE INTO voucher_templates(code,title,kind,value,valid_days) VALUES('WELCOME','Скидка 10%','percent',10,30)`,
  ).run()
})

describe('L-06: атомарное погашение ваучера', () => {
  it('второй чек с тем же ваучером не погашает его повторно', async () => {
    const dev = deviceWithKey()
    const user = userWithCard()
    grantVoucher(user.id, 'WELCOME')
    const vid = Number((db.prepare('SELECT MAX(id) AS id FROM vouchers').get() as { id: number }).id)

    const first = `${dev.id}-r-${++seq}`
    const r1 = applyReceipts([receiptToken(dev.priv, dev.id, user.id, first, [vid])])
    expect(r1.applied).toEqual([first])
    expect(voucherRow(vid).receiptId).toBe(first)

    const second = `${dev.id}-r-${++seq}`
    const r2 = applyReceipts([receiptToken(dev.priv, dev.id, user.id, second, [vid])])
    expect(r2.applied).toEqual([second]) // чек применён
    expect(voucherRow(vid).receiptId).toBe(first) // но ваучер остался за первым
    expect(disputesFor(second).map((d) => d.kind)).toContain('voucher_double_use')
  })

  it('чужой ваучер не погашается и попадает в споры', () => {
    const dev = deviceWithKey()
    const owner = userWithCard()
    const other = userWithCard()
    grantVoucher(owner.id, 'WELCOME')
    const vid = Number((db.prepare('SELECT MAX(id) AS id FROM vouchers').get() as { id: number }).id)

    const receipt = `${dev.id}-r-${++seq}`
    applyReceipts([receiptToken(dev.priv, dev.id, other.id, receipt, [vid])])

    expect(voucherRow(vid).usedAt).toBeNull()
    expect(disputesFor(receipt).map((d) => d.kind)).toContain('voucher_invalid')
  })

})
