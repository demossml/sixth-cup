/**
 * Q-05: ошибка склада не теряется — лог, `disputes`, `evotor_docs.last_error`.
 * Статус документа остаётся PROCESSED, лояльность не откатывается (D-04).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { PollService } from '../integrations/evotor/sync/PollService'
import { createToken } from '../integrations/evotor/tokenStore'
import { createItem, createSupplier, docLastError, docStatus, loyaltyOps, productWithNorm, receive, sellDoc } from './wh-helpers'

const STORE = 'store-wh-errors'

let docs: Record<string, unknown>[] = []
const fakeClient = {
  isConfigured: true,
  getStores: async () => ({ items: [{ uuid: STORE, name: 'Точка W05' }] }),
  getDocuments: async () => ({ items: docs }),
} as any

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`
let cards = 0

function withCard(): string {
  const code = String(900 + ++cards)
  const t = Date.now()
  db.prepare(
    `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)`,
  ).run(`err-card-${code}`, `+700000${code}`, `ERRCARD${code}`, `CARD-${code}`, code, t)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, t)
  return code
}

const disputes = (receiptId: string) =>
  db
    .prepare(`SELECT kind, details FROM disputes WHERE receipt_id=?`)
    .all(receiptId) as { kind: string; details: string }[]

beforeEach(() => {
  docs = []
  createToken(db, { label: 'wh', token: 'wh-token', storeUuids: [STORE] })
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, sync_enabled, updated_at) VALUES(?,?,1,?)
     ON CONFLICT(store_uuid) DO UPDATE SET sync_enabled=1`,
  ).run(STORE, 'Точка W05', Date.now())
})

const boom = () => {
  throw new Error('склад упал')
}

describe('Q-05: видимые ошибки списания', () => {
  it('SELL с картой: лояльность прошла, ошибка склада записана', async () => {
    const item = await createItem('Ошибка карта', 'g')
    await receive(await createSupplier('Пост ошибка 1'), [{ stockItemId: item, qty: 100 }])
    const commodity = uniq('uuid')
    await productWithNorm(401, commodity, STORE, item, 18)
    const code = withCard()

    const doc = {
      ...sellDoc(uniq('sell'), [{ commodityUuid: commodity, qty: 1 }], { sc: { v: 2, c: code, ts: 1 } }),
      uuid: 'sell-stock-fail-card',
    }
    docs = [doc]
    await new PollService(db, fakeClient, { applyStock: boom }).runFast()

    expect(loyaltyOps('sell-stock-fail-card')).toBe(1)
    expect(docStatus(STORE, 'sell-stock-fail-card')).toBe('PROCESSED')
    expect(docLastError(STORE, 'sell-stock-fail-card')).toMatch(/^stock: /)
    const d = disputes('sell-stock-fail-card')
    expect(d).toHaveLength(1)
    expect(d[0].kind).toBe('stock_writeoff_failed')
    expect(d[0].details).toMatch(/склад упал/)
  })

  it('SELL без карты: ошибка видна так же', async () => {
    const doc = { ...sellDoc(uniq('sell'), [{ commodityUuid: uniq('uuid'), qty: 1 }]), uuid: 'sell-stock-fail-plain' }
    docs = [doc]
    await new PollService(db, fakeClient, { applyStock: boom }).runFast()

    expect(docStatus(STORE, 'sell-stock-fail-plain')).toBe('PROCESSED')
    expect(docLastError(STORE, 'sell-stock-fail-plain')).toMatch(/^stock: /)
    expect(disputes('sell-stock-fail-plain').map((x) => x.kind)).toContain('stock_writeoff_failed')
  })

  it('успешный склад не пишет ни споров, ни last_error', async () => {
    const item = await createItem('Успех склад', 'g')
    await receive(await createSupplier('Пост ошибка 2'), [{ stockItemId: item, qty: 100 }])
    const commodity = uniq('uuid')
    await productWithNorm(402, commodity, STORE, item, 5)

    const doc = { ...sellDoc(uniq('sell'), [{ commodityUuid: commodity, qty: 1 }]), uuid: 'sell-stock-ok' }
    docs = [doc]
    await new PollService(db, fakeClient).runFast()

    expect(docStatus(STORE, 'sell-stock-ok')).toBe('PROCESSED')
    expect(docLastError(STORE, 'sell-stock-ok')).toBeNull()
    expect(disputes('sell-stock-ok')).toHaveLength(0)
  })
})
