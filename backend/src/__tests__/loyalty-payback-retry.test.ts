/**
 * L-07: PAYBACK без базового SELL не теряется навсегда — документ встаёт в очередь
 * на повтор и обрабатывается, когда базовый чек появился. Сторно ровно одно.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { PollService, RETRY_MAX_ATTEMPTS } from '../integrations/evotor/sync/PollService'
import { createToken } from '../integrations/evotor/tokenStore'
import { admin, createItem, loyaltyOps, productWithNorm, sellDoc, paybackDoc, receive, createSupplier } from './wh-helpers'

const STORE = 'store-loy-retry'

let docs: Record<string, unknown>[] = []
const fakeClient = {
  isConfigured: true,
  getStores: async () => ({ items: [{ uuid: STORE, name: 'Точка ретрая' }] }),
  getDocuments: async () => ({ items: docs }),
} as any

let seq = 0
let cards = 0
const uniq = (p: string) => `${p}-${++seq}`

function withCard(): string {
  const code = String(600 + ++cards)
  const t = Date.now()
  db.prepare(
    `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)`,
  ).run(`retry-card-${code}`, `+700000${code}`, `RTRYCARD${code}`, `CARD-${code}`, code, t)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, t)
  return code
}

const docRow = (docId: string) =>
  db
    .prepare('SELECT status, attempts, last_error AS lastError, next_retry_at AS nextRetryAt FROM evotor_docs WHERE doc_id=?')
    .get(docId) as { status: string; attempts: number; lastError: string | null; nextRetryAt: number | null }

/** Тест управляет временем: снимаем задержку, чтобы poll сразу взял документ. */
const makeDue = (docId: string) => db.prepare('UPDATE evotor_docs SET next_retry_at=0 WHERE doc_id=?').run(docId)

beforeEach(() => {
  docs = []
  createToken(db, { label: 'retry', token: 'retry-token', storeUuids: [STORE] })
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, sync_enabled, updated_at) VALUES(?,?,1,?)
     ON CONFLICT(store_uuid) DO UPDATE SET sync_enabled=1`,
  ).run(STORE, 'Точка ретрая', Date.now())
})

async function fixture(name: string) {
  const item = await createItem(name, 'g')
  await receive(await createSupplier(`Пост ${name}`), [{ stockItemId: item, qty: 500 }])
  const commodity = uniq('uuid')
  await productWithNorm(800 + ++seq, commodity, STORE, item, 10)
  return { item, commodity }
}

describe('L-07: повторная обработка PAYBACK', () => {
  it('PAYBACK приходит раньше SELL: встаёт в очередь, затем сторнируется один раз', async () => {
    const { commodity } = await fixture('Ретрай база')
    const code = withCard()
    const extras = { sc: { v: 2, c: code, free: 0, cb: 0, ts: 1 } }
    const sellUuid = 'retry-sell-1'
    const paybackUuid = 'retry-payback-1'

    // 1. PAYBACK приходит первым — базового SELL ещё нет
    docs = [paybackDoc(paybackUuid, sellUuid, [{ commodityUuid: commodity, qty: 1 }], extras)]
    await new PollService(db, fakeClient).runFast()

    const first = docRow(paybackUuid)
    expect(first.status).toBe('FAILED')
    expect(first.lastError).toMatch(/base SELL not found/)
    expect(first.attempts).toBe(1)
    expect(first.nextRetryAt).toBeGreaterThan(0) // не «навсегда потерян»
    expect(loyaltyOps(paybackUuid)).toBe(0)

    // 2. Появился базовый SELL, время повтора наступило
    docs = [sellDoc(sellUuid, [{ commodityUuid: commodity, qty: 2 }], extras)]
    await new PollService(db, fakeClient).runFast()
    expect(loyaltyOps(sellUuid)).toBe(1)

    makeDue(paybackUuid)
    // Cloud отдаёт тот же PAYBACK: повтор находит его в окне и обрабатывает
    docs = [paybackDoc(paybackUuid, sellUuid, [{ commodityUuid: commodity, qty: 1 }], extras)]
    await new PollService(db, fakeClient).runFast()

    const after = docRow(paybackUuid)
    expect(after.status).toBe('PROCESSED')
    expect(after.lastError).toBeNull()
    expect(after.nextRetryAt).toBeNull()
    expect(loyaltyOps(paybackUuid)).toBe(1) // сторно применилось
  })

  it('повторная обработка того же PAYBACK не сторнирует дважды', async () => {
    const { commodity } = await fixture('Ретрай идемпотентность')
    const code = withCard()
    const extras = { sc: { v: 2, c: code, free: 0, cb: 0, ts: 1 } }
    const sellUuid = 'retry-sell-2'
    const paybackUuid = 'retry-payback-2'

    docs = [sellDoc(sellUuid, [{ commodityUuid: commodity, qty: 2 }], extras)]
    await new PollService(db, fakeClient).runFast()

    docs = [paybackDoc(paybackUuid, sellUuid, [{ commodityUuid: commodity, qty: 1 }], extras)]
    await new PollService(db, fakeClient).runFast()
    expect(loyaltyOps(paybackUuid)).toBe(1)

    // ещё раз тот же документ и ещё один заход повтора
    makeDue(paybackUuid)
    docs = [paybackDoc(paybackUuid, sellUuid, [{ commodityUuid: commodity, qty: 1 }], extras)]
    await new PollService(db, fakeClient).runFast()

    expect(loyaltyOps(paybackUuid)).toBe(1) // ровно одно сторно
    expect(docRow(paybackUuid).status).toBe('PROCESSED')
  })

  it('после исчерпания попыток документ закрывается окончательно', async () => {
    const { commodity } = await fixture('Ретрай лимит')
    const code = withCard()
    const extras = { sc: { v: 2, c: code, free: 0, cb: 0, ts: 1 } }
    const paybackUuid = 'retry-payback-exhausted'
    const orphan = paybackDoc(paybackUuid, 'no-such-sell', [{ commodityUuid: commodity, qty: 1 }], extras)
    docs = [orphan]
    await new PollService(db, fakeClient).runFast()

    expect(docRow(paybackUuid).nextRetryAt).toBeGreaterThan(0)
    // имитируем исчерпание: следующая попытка будет десятой
    db.prepare('UPDATE evotor_docs SET attempts=? WHERE doc_id=?').run(RETRY_MAX_ATTEMPTS - 1, paybackUuid)
    makeDue(paybackUuid)
    docs = [orphan]
    await new PollService(db, fakeClient).runFast()

    const row = docRow(paybackUuid)
    expect(row.status).toBe('FAILED')
    expect(row.attempts).toBe(RETRY_MAX_ATTEMPTS)
    expect(row.nextRetryAt).toBeNull() // терминально
    expect(row.lastError).toMatch(/giving up/)
  })

  it('ошибка данных не ставится в очередь повтора', async () => {
    const doc = { ...sellDoc('retry-bad-card', [{ commodityUuid: 'x', qty: 1 }], { sc: { v: 2, c: '999999', ts: 1 } }) }
    docs = [doc]
    await new PollService(db, fakeClient).runFast()

    const row = docRow('retry-bad-card')
    expect(row.status).toBe('FAILED')
    expect(row.nextRetryAt).toBeNull() // card code not found — не лечится повтором
    expect(row.lastError).toMatch(/card code not found/)
  })
})
