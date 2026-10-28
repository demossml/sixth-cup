/**
 * 3.2: возврат сторнирует лояльность даже если в PAYBACK нет `extras.sc`.
 * Проверка идёт через PollService — как в продакшене, а не прямым вызовом handlePayback.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { PollService } from '../integrations/evotor/sync/PollService'
import { createToken } from '../integrations/evotor/tokenStore'
import { createItem, createSupplier, productWithNorm, receive } from './wh-helpers'

const STORE = 'store-loy-nosc'

let docs: Record<string, unknown>[] = []
const fakeClient = {
  isConfigured: true,
  getStores: async () => ({ items: [{ uuid: STORE, name: 'Точка без sc' }] }),
  getDocuments: async () => ({ items: docs }),
} as any

let seq = 0
let cards = 0
const uniq = (p: string) => `${p}-${++seq}`

function withCard(): string {
  const code = String(800 + ++cards)
  const t = Date.now()
  db.prepare(
    `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)`,
  ).run(`nosc-${code}`, `+7300${code}`, `NOSC${code}`, `CARD-${code}`, code, t)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, t)
  return code
}

const sell = (uuid: string, code: string, qty = 2) => ({
  uuid,
  type: 'SELL',
  closeDate: new Date().toISOString(),
  extras: { sc: { v: 2, c: code, free: 0, cb: 0, ts: 1 } },
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: qty, price: 30000 }],
  closeSum: String(30000 * qty),
})

/** Тот же возврат, но без extras.sc вообще. */
const paybackNoSc = (uuid: string, base: string, qty = 1) => ({
  uuid,
  type: 'PAYBACK',
  baseDocumentUUID: base,
  closeDate: new Date().toISOString(),
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: qty, price: 30000 }],
  closeSum: String(30000 * qty),
})

const paybackWithSc = (uuid: string, base: string, code: string, qty = 1) => ({
  ...paybackNoSc(uuid, base, qty),
  extras: { sc: { v: 2, c: code, ts: 1 } },
})

const COMMODITY = 'p-nosc-latte'

const cups = (code: string) =>
  Number(
    (
      db.prepare('SELECT paid_total AS p FROM cards WHERE user_id=(SELECT id FROM users WHERE card_code=?)').get(code) as {
        p: number
      }
    ).p,
  )

const ops = (docId: string) =>
  db.prepare(`SELECT kind, cups_counted AS cups FROM loyalty_ops WHERE doc_id=?`).all(docId) as {
    kind: string
    cups: number
  }[]

const docRow = (docId: string) =>
  db.prepare('SELECT status FROM evotor_docs WHERE doc_id=?').get(docId) as { status: string }

beforeEach(() => {
  docs = []
  createToken(db, { label: 'nosc', token: 'nosc-token', storeUuids: [STORE] })
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, sync_enabled, updated_at) VALUES(?,?,1,?)
     ON CONFLICT(store_uuid) DO UPDATE SET sync_enabled=1`,
  ).run(STORE, 'Точка без sc', Date.now())
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,counts_as_cup) VALUES(970,'Latte',300,1)`).run()
  db.prepare(`INSERT OR IGNORE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(970,?,?)`).run(
    STORE,
    COMMODITY,
  )
})

const poll = () => new PollService(db, fakeClient).runFast()

describe('3.2: возврат без sc', () => {
  it('PAYBACK со sc по-прежнему сторнирует', async () => {
    const code = withCard()
    docs = [sell('nosc-sell-1', code, 2)]
    await poll()
    expect(cups(code)).toBe(2)

    docs = [paybackWithSc('nosc-pb-1', 'nosc-sell-1', code, 1)]
    await poll()
    expect(cups(code)).toBe(1)
    expect(ops('nosc-pb-1')).toEqual([{ kind: 'PAYBACK', cups: 1 }])
  })

  it('PAYBACK БЕЗ sc сторнирует по базовому чеку', async () => {
    const code = withCard()
    docs = [sell('nosc-sell-2', code, 2)]
    await poll()
    expect(cups(code)).toBe(2)

    docs = [paybackNoSc('nosc-pb-2', 'nosc-sell-2', 1)]
    await poll()

    expect(cups(code)).toBe(1) // сторно прошло без sc
    expect(ops('nosc-pb-2')).toEqual([{ kind: 'PAYBACK', cups: 1 }])
    expect(docRow('nosc-pb-2').status).toBe('PROCESSED')
  })

  it('PAYBACK без базового SELL с лояльностью ничего не меняет', async () => {
    const code = withCard()
    docs = [paybackNoSc('nosc-pb-3', 'no-such-sell', 1)]
    await poll()

    expect(cups(code)).toBe(0)
    expect(ops('nosc-pb-3')).toHaveLength(0)
    expect(docRow('nosc-pb-3').status).toBe('PROCESSED')
  })

  it('повторный PAYBACK без sc не сторнирует дважды', async () => {
    const code = withCard()
    docs = [sell('nosc-sell-4', code, 2)]
    await poll()

    const pb = paybackNoSc('nosc-pb-4', 'nosc-sell-4', 1)
    docs = [pb]
    await poll()
    expect(cups(code)).toBe(1)

    // тот же документ приходит снова: INSERT OR IGNORE в evotor_docs не даёт переиграть
    await poll()
    expect(cups(code)).toBe(1)
    expect(ops('nosc-pb-4')).toHaveLength(1)
  })
})
