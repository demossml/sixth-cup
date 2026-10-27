/**
 * Q-01: сырьё списывается на КАЖДОМ чеке SELL, а не только на чеках с картой лояльности.
 * Склад живёт в `PollService` → `applyStockForDocument`, лояльность не меняется.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { PollService } from '../integrations/evotor/sync/PollService'
import { applyStockForDocument } from '../integrations/evotor/processing/StockHandler'
import { handleSell } from '../integrations/evotor/processing/SellHandler'
import { writeOffSellByNorms } from '../modules/admin/stockWriteOff'
import { createToken } from '../integrations/evotor/tokenStore'
import {
  admin,
  balance,
  createItem,
  createSupplier,
  docStatus,
  loyaltyOps,
  movements,
  paybackDoc,
  productWithNorm,
  receive,
  sellDoc,
} from './wh-helpers'

const STORE = 'store-wh-sell'

let docs: Record<string, unknown>[] = []
const fakeClient = {
  isConfigured: true,
  getStores: async () => ({ items: [{ uuid: STORE, name: 'Точка W01' }] }),
  getDocuments: async () => ({ items: docs }),
} as any

const saleOuts = (item: number) => movements(item).filter((m) => m.kind === 'sale_out')

let seq = 0
let cards = 0
const uniq = (prefix: string) => `${prefix}-${++seq}`

function enableStore() {
  createToken(db, { label: 'wh', token: 'wh-token', storeUuids: [STORE] })
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, sync_enabled, updated_at) VALUES(?,?,1,?)
     ON CONFLICT(store_uuid) DO UPDATE SET sync_enabled=1`,
  ).run(STORE, 'Точка W01', Date.now())
}

/** Карта для «лояльного» чека: гость + короткий код. */
function withCard(): string {
  const t = Date.now()
  const code = String(700 + ++cards)
  db.prepare(
    `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at)
     VALUES(?,?,?,?,?,?)`,
  ).run(`wh-card-${code}`, `+700000${code}`, `WHCARD${code}`, `CARD-${code}`, code, t)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, Date.now())
  return code
}

async function poll() {
  return new PollService(db, fakeClient).runFast()
}

beforeEach(() => {
  docs = []
  enableStore()
})

describe('Q-01: списание сырья на каждом SELL', () => {
  it('чек БЕЗ карты списывает сырьё по норме', async () => {
    const item = await createItem('Кофе зерно', 'g')
    await receive(await createSupplier('Поставщик W01'), [{ stockItemId: item, qty: 1000 }])
    const commodity = uniq('uuid')
    await productWithNorm(101, commodity, STORE, item, 18)

    const doc = sellDoc(uniq('sell'), [{ commodityUuid: commodity, qty: 2 }], {})
    docs = [doc]
    const r = await poll()

    expect(r.inserted).toBe(1)
    expect(balance(item)).toBe(1000 - 36)
    expect(loyaltyOps()).toBe(0)
    expect(docStatus(STORE, String(doc.uuid))).toBe('PROCESSED')
    expect(saleOuts(item)).toHaveLength(1)
  })

  it('повторная обработка того же чека не списывает второй раз', async () => {
    const item = await createItem('Кофе зерно повтор', 'g')
    await receive(await createSupplier('Поставщик W01b'), [{ stockItemId: item, qty: 500 }])
    const commodity = uniq('uuid')
    await productWithNorm(102, commodity, STORE, item, 18)

    const doc = { ...sellDoc(uniq('sell'), [{ commodityUuid: commodity, qty: 1 }]), uuid: 'sell-repeat' }
    docs = [doc]
    await poll()
    expect(balance(item)).toBe(500 - 18)

    // тот же документ приходит снова: `INSERT OR IGNORE` в evotor_docs не даёт переиграть
    await poll()
    expect(balance(item)).toBe(500 - 18)
  })

  it('чек С картой: лояльность и склад оба сработали ровно один раз', async () => {
    const item = await createItem('Кофе зерно карта', 'g')
    await receive(await createSupplier('Поставщик W01c'), [{ stockItemId: item, qty: 500 }])
    const commodity = uniq('uuid')
    await productWithNorm(103, commodity, STORE, item, 18)
    const code = withCard()

    const doc = {
      ...sellDoc(uniq('sell'), [{ commodityUuid: commodity, qty: 3 }], {
        sc: { v: 2, c: code, free: 0, cb: 0, ts: 1 },
      }),
      uuid: 'sell-with-card',
    }
    docs = [doc]
    await poll()

    expect(loyaltyOps('sell-with-card')).toBe(1)
    expect(balance(item)).toBe(500 - 54)
    expect(saleOuts(item)).toHaveLength(1)
  })

  it('товар без нормы: движений нет, чек PROCESSED', async () => {
    const item = await createItem('Без норм', 'g')
    await receive(await createSupplier('Поставщик W01d'), [{ stockItemId: item, qty: 100 }])
    const commodity = uniq('uuid')
    db.prepare(`INSERT OR REPLACE INTO products(id,name,price) VALUES(104,'Без норм',150)`).run()
    db.prepare(`INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(104,?,?)`).run(STORE, commodity)

    const doc = { ...sellDoc(uniq('sell'), [{ commodityUuid: commodity, qty: 1 }]), uuid: 'sell-no-norm' }
    docs = [doc]
    await poll()

    expect(saleOuts(item)).toHaveLength(0)
    expect(docStatus(STORE, 'sell-no-norm')).toBe('PROCESSED')
  })

  it('позиция без связи с товаром меню: движений нет', async () => {
    const item = await createItem('Несвязанная', 'g')
    await receive(await createSupplier('Поставщик W01e'), [{ stockItemId: item, qty: 100 }])

    const doc = { ...sellDoc(uniq('sell'), [{ commodityUuid: uniq('unknown'), qty: 1 }]), uuid: 'sell-unknown' }
    docs = [doc]
    await poll()

    expect(saleOuts(item)).toHaveLength(0)
    expect(docStatus(STORE, 'sell-unknown')).toBe('PROCESSED')
  })

  it('handleSell больше не трогает склад (склад только в PollService)', async () => {
    const item = await createItem('Только лояльность', 'g')
    await receive(await createSupplier('Поставщик W01f'), [{ stockItemId: item, qty: 100 }])
    const commodity = uniq('uuid')
    await productWithNorm(105, commodity, STORE, item, 18)
    const code = withCard()

    const doc = {
      ...sellDoc(uniq('sell'), [{ commodityUuid: commodity, qty: 2 }], {
        sc: { v: 2, c: code, free: 0, cb: 0, ts: 1 },
      }),
      uuid: 'sell-direct',
    }
    const r = handleSell(db, STORE, doc)
    expect(r.processed).toBe(true)
    expect(saleOuts(item)).toHaveLength(0)
    expect(balance(item)).toBe(100)
  })

  it('нехватка партий: продажа не блокируется, остаток уходит в минус', async () => {
    const item = await createItem('Мало на складе', 'g')
    await receive(await createSupplier('Поставщик W01g'), [{ stockItemId: item, qty: 10 }])
    const commodity = uniq('uuid')
    await productWithNorm(106, commodity, STORE, item, 18)

    const doc = { ...sellDoc(uniq('sell'), [{ commodityUuid: commodity, qty: 2 }]), uuid: 'sell-shortage' }
    docs = [doc]
    await poll()

    expect(balance(item)).toBe(10 - 36)
    expect(movements(item).some((m) => m.batchId === null && m.kind === 'sale_out')).toBe(true)
    expect(docStatus(STORE, 'sell-shortage')).toBe('PROCESSED')
  })
})

describe('Q-01: атомарность списания (D-05)', () => {
  it('падение на второй строке откатывает весь чек', async () => {
    const a = await createItem('Атом A', 'g')
    const b = await createItem('Атом B', 'g')
    const supplier = await createSupplier('Поставщик W01h')
    await receive(supplier, [{ stockItemId: a, qty: 100 }])
    await receive(supplier, [{ stockItemId: b, qty: 100 }])
    const ua = uniq('uuid')
    const ub = uniq('uuid')
    await productWithNorm(107, ua, STORE, a, 10)
    await productWithNorm(108, ub, STORE, b, 10)

    // Обёртка ломает второй INSERT движений — транзакция обязана откатить и первый.
    let inserts = 0
    const brittle = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            const stmt = (target as any).prepare(sql)
            if (!/INSERT INTO stock_movements/.test(sql)) return stmt
            return new Proxy(stmt, {
              get(st: any, p) {
                if (p === 'run') {
                  return (...args: unknown[]) => {
                    inserts++
                    if (inserts >= 2) throw new Error('boom on stock_movements')
                    return st.run(...args)
                  }
                }
                const v = st[p]
                return typeof v === 'function' ? v.bind(st) : v
              },
            })
          }
        }
        const v = (target as any)[prop]
        return typeof v === 'function' ? v.bind(target) : v
      },
    }) as unknown as typeof db

    const docId = 'doc-atomic'
    expect(() =>
      writeOffSellByNorms(brittle, STORE, docId, [
        { productUuid: ua, qty: 1 },
        { productUuid: ub, qty: 1 },
      ]),
    ).toThrow(/boom/)

    const written = db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE doc_id=?`).get(docId) as { n: number }
    expect(written.n).toBe(0)
    expect(balance(a)).toBe(100)
    expect(balance(b)).toBe(100)
  })
})

describe('W01: PAYBACK пока не трогает склад (это STEP-W02)', () => {
  it('applyStockForDocument пропускает PAYBACK как неизвестный тип', async () => {
    const item = await createItem('Пейбек', 'g')
    await receive(await createSupplier('Поставщик W01i'), [{ stockItemId: item, qty: 100 }])
    const doc = paybackDoc('payback-1', 'sell-1', [{ commodityUuid: 'x', qty: 1 }])
    const r = applyStockForDocument(db, STORE, doc)
    expect(r.kind).toBe('skipped')
    expect(balance(item)).toBe(100)
  })

  it('неизвестный тип документа не роняет обработку', async () => {
    const r = applyStockForDocument(db, STORE, { uuid: 'd', type: 'CORRECTION' })
    expect(r).toEqual({ kind: 'skipped', reason: 'type_CORRECTION' })
    const r2 = applyStockForDocument(db, STORE, { type: 'SELL' })
    expect(r2).toEqual({ kind: 'skipped', reason: 'no_doc_id' })
  })
})

describe('W01: админский API склада не сломан', () => {
  it('остатки по-прежнему читаются', async () => {
    const r = await admin('GET', '/stock/balances')
    expect(r.status).toBe(200)
    expect(Array.isArray(r.json.balances)).toBe(true)
  })
})
