/**
 * Блок B: подарки (free cup) — наблюдаемость clamp и корректный повтор обработки
 * после сбоя (резерв не должен «сгорать» на повторном прогоне того же чека).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-gift-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { db } = await import('../db')
const { ensureCard, buildCardProof } = await import('../modules/loyalty/proof')
const { resolveAndReserve, consumeReservation } = await import('../modules/loyalty/reservations')
const { handleSell } = await import('../integrations/evotor/processing/SellHandler')

const STORE = 'store-gift'
const COMMODITY = 'p-gift-latte'
const APP = '151071e8-88a4-44f6-b71a-b17c559f9b7d'

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`

function guest(paidTotal = 5): { id: number; cardId: string; code: string; proof: string } {
  const code = String(3000 + ++seq)
  const t = Date.now()
  db.prepare(
    `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)`,
  ).run(`gift-${code}`, `+7500${code}`, `GIFT${code}`, `CARD-${code}`, code, t)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  ensureCard(id)
  db.prepare('UPDATE cards SET paid_total=? WHERE user_id=?').run(paidTotal, id)
  return { id, cardId: `CARD-${code}`, code, proof: buildCardProof(id) }
}

const sell = (docId: string, c: string, opts: { free?: number; cb?: number; op?: string } = {}) => ({
  uuid: docId,
  type: 'SELL',
  closeDate: new Date().toISOString(),
  extras: { [APP]: { sc: { v: 2, c, op: opts.op, free: opts.free ?? 0, cb: opts.cb ?? 0, ts: 1 } } },
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: 30000 }],
  closeSum: '30000',
})

const disputes = (receiptId: string) =>
  db.prepare('SELECT kind, details FROM disputes WHERE receipt_id=?').all(receiptId) as {
    kind: string
    details: string
  }[]

const cardState = (userId: number) =>
  db.prepare('SELECT paid_total AS paidTotal, free_used AS freeUsed FROM cards WHERE user_id=?').get(userId) as {
    paidTotal: number
    freeUsed: number
  }

beforeEach(() => {
  // одна позиция-чашка в каталоге, иначе cups_counted = 0 и тесты теряют смысл
  db.prepare(`INSERT OR REPLACE INTO products(id,name,price,counts_as_cup) VALUES(950,'Latte',300,1)`).run()
  db.prepare(`INSERT OR IGNORE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(950,?,?)`).run(
    STORE,
    COMMODITY,
  )
})

describe('B: подарки и clamp', () => {
  it('claimed free без резерва → спор с читаемыми полями, free не списан', () => {
    const g = guest()
    const docId = uniq('sell')
    const res = handleSell(db as any, STORE, sell(docId, g.proof, { free: 1 }))
    expect(res.processed).toBe(true)

    const st = cardState(g.id)
    expect(st.freeUsed).toBe(0) // льгота не применена
    expect(st.paidTotal).toBe(6) // платная чашка начислена

    const clamp = disputes(docId).find((d) => d.kind === 'loyalty_claim_clamped')
    expect(clamp).toBeTruthy()
    const details = JSON.parse(clamp!.details)
    expect(details).toMatchObject({
      claimedFree: 1,
      appliedFree: 0,
      claimedCb: 0,
      appliedCb: 0,
      freeAvail: 1,
      cups: 1,
      hadReservation: false,
    })
  })

  it('numeric code не списывает льготы даже при claimed free', () => {
    const g = guest()
    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, g.code, { free: 1 }))
    expect(cardState(g.id).freeUsed).toBe(0)
    const clamp = disputes(docId).find((d) => d.kind === 'loyalty_claim_clamped')
    expect(JSON.parse(clamp!.details).hadReservation).toBe(false)
  })

  it('повторная обработка того же чека возвращает льготы резерва (retry после сбоя)', () => {
    const g = guest()
    const r = resolveAndReserve({ code: g.proof, storeUuid: STORE, deviceUuid: 'dev-1' })
    expect(r.ok).toBe(true)
    const op = (r as any).reservationId as string

    // первая попытка «сгорела»: резерв уже помечен этим документом
    const first = consumeReservation(db as any, op, g.cardId, STORE, 'retry-doc-1')
    expect(first).toEqual({ free: 1, cb: 0 })

    // повтор того же документа обязан получить те же льготы, а не нули
    const again = consumeReservation(db as any, op, g.cardId, STORE, 'retry-doc-1')
    expect(again).toEqual({ free: 1, cb: 0 })

    // другой документ с тем же (уже потреблённым) резервом — нули
    const other = consumeReservation(db as any, op, g.cardId, STORE, 'other-doc')
    expect(other).toEqual({ free: 0, cb: 0 })
  })

  it('успешный SELL с резервом списывает бесплатную чашку', () => {
    const g = guest()
    const r = resolveAndReserve({ code: g.proof, storeUuid: STORE, deviceUuid: 'dev-2' })
    const docId = uniq('sell')
    handleSell(db as any, STORE, sell(docId, g.proof, { free: 1, op: (r as any).reservationId }))

    const st = cardState(g.id)
    expect(st.freeUsed).toBe(1)
    expect(st.paidTotal).toBe(5) // бесплатная не считается платной
    expect(disputes(docId).some((d) => d.kind === 'loyalty_claim_clamped')).toBe(false)
  })
})
