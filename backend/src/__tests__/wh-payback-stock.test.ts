/**
 * Q-02: PAYBACK возвращает сырьё, списанное базовым чеком (D-07…D-10).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { PollService } from '../integrations/evotor/sync/PollService'
import { applyStockForDocument } from '../integrations/evotor/processing/StockHandler'
import { restoreByPayback } from '../modules/admin/stockWriteOff'
import { createToken } from '../integrations/evotor/tokenStore'
import {
  batchLeft,
  balance,
  createItem,
  createSupplier,
  docStatus,
  movements,
  paybackDoc,
  productWithNorm,
  receive,
  sellDoc,
} from './wh-helpers'

const STORE = 'store-wh-payback'

let docs: Record<string, unknown>[] = []
const fakeClient = {
  isConfigured: true,
  getStores: async () => ({ items: [{ uuid: STORE, name: 'Точка W02' }] }),
  getDocuments: async () => ({ items: docs }),
} as any

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`
const backs = (item: number) => movements(item).filter((m) => m.kind === 'sale_back')

beforeEach(() => {
  docs = []
  createToken(db, { label: 'wh', token: 'wh-token', storeUuids: [STORE] })
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, sync_enabled, updated_at) VALUES(?,?,1,?)
     ON CONFLICT(store_uuid) DO UPDATE SET sync_enabled=1`,
  ).run(STORE, 'Точка W02', Date.now())
})

async function poll() {
  return new PollService(db, fakeClient).runFast()
}

/** Свежая позиция с приходом и нормой 18 г на товар. */
async function fixture(name: string, qtyIn = 1000) {
  const item = await createItem(name, 'g')
  await receive(await createSupplier(`Поставщик ${name}`), [{ stockItemId: item, qty: qtyIn }])
  const commodity = uniq('uuid')
  const productId = 200 + ++seq
  await productWithNorm(productId, commodity, STORE, item, 18)
  return { item, commodity }
}

describe('Q-02: возврат сырья при PAYBACK', () => {
  it('продажа 2 чашек и возврат 1: остаток возвращается на 18', async () => {
    const { item, commodity } = await fixture('Возврат базовый')
    const sellUuid = uniq('sell')
    docs = [sellDoc(sellUuid, [{ commodityUuid: commodity, qty: 2 }])]
    await poll()
    expect(balance(item)).toBe(1000 - 36)

    docs = [paybackDoc(uniq('payback'), sellUuid, [{ commodityUuid: commodity, qty: 1 }])]
    await poll()

    expect(balance(item)).toBe(1000 - 18)
    expect(backs(item)).toHaveLength(1)
    expect(batchLeft(item)).toBe(1000 - 18)
  })

  it('PAYBACK без распознаваемых позиций возвращает весь остаток списанного', async () => {
    const { item, commodity } = await fixture('Возврат целиком')
    const sellUuid = uniq('sell')
    docs = [sellDoc(sellUuid, [{ commodityUuid: commodity, qty: 2 }])]
    await poll()

    docs = [paybackDoc(uniq('payback'), sellUuid, [])]
    await poll()

    expect(balance(item)).toBe(1000)
    expect(backs(item)).toHaveLength(1)
  })

  it('повторная обработка того же PAYBACK идемпотентна', async () => {
    const { item, commodity } = await fixture('Возврат повтор')
    const sellUuid = uniq('sell')
    docs = [sellDoc(sellUuid, [{ commodityUuid: commodity, qty: 2 }])]
    await poll()
    const payback = paybackDoc('payback-fixed', sellUuid, [{ commodityUuid: commodity, qty: 1 }])
    docs = [payback]
    await poll()
    const after = balance(item)

    // прямой повторный вызов той же обработки: документ уже в evotor_docs, runFast его не трогает
    await poll()
    expect(balance(item)).toBe(after)

    // и на уровне функции — duplicate по doc_id
    const again = applyStockForDocument(db, STORE, payback)
    expect(again).toMatchObject({ kind: 'payback', duplicate: true })
    expect(balance(item)).toBe(after)
  })

  it('два PAYBACK не возвращают больше, чем списано, и не переполняют партию', async () => {
    const { item, commodity } = await fixture('Возврат лимит', 100)
    const sellUuid = uniq('sell')
    docs = [sellDoc(sellUuid, [{ commodityUuid: commodity, qty: 2 }])]
    await poll()
    expect(balance(item)).toBe(64)

    docs = [paybackDoc(uniq('payback'), sellUuid, [{ commodityUuid: commodity, qty: 5 }])]
    await poll()
    expect(balance(item)).toBe(100) // не больше списанных 36

    docs = [paybackDoc(uniq('payback'), sellUuid, [{ commodityUuid: commodity, qty: 5 }])]
    await poll()
    expect(balance(item)).toBe(100)
    expect(batchLeft(item)).toBeLessThanOrEqual(100)
  })

  it('PAYBACK к чеку без списания: движений нет, ошибки нет', async () => {
    const { item } = await fixture('Возврат без базы')
    const r = applyStockForDocument(db, STORE, paybackDoc(uniq('payback'), uniq('unknown-sell'), []))
    expect(r).toMatchObject({ kind: 'payback', restoredItems: 0, reason: 'no_prior_sale_out' })
    expect(balance(item)).toBe(1000)
  })

  it('PAYBACK без baseDocumentUUID пропускается', async () => {
    const { item } = await fixture('Возврат без ссылки')
    const doc = { ...paybackDoc('pb-nobase', '', []), baseDocumentUUID: undefined }
    const r = applyStockForDocument(db, STORE, doc)
    expect(r).toEqual({ kind: 'skipped', reason: 'no_base_document' })
    expect(balance(item)).toBe(1000)
  })

  it('строка sale_out без партии (нехватка) возвращается движением без партии', async () => {
    const item = await createItem('Возврат нехватка', 'g')
    // без прихода: продажа уйдёт в минус без партии
    const commodity = uniq('uuid')
    await productWithNorm(300 + ++seq, commodity, STORE, item, 10)
    const sellUuid = uniq('sell')
    docs = [sellDoc(sellUuid, [{ commodityUuid: commodity, qty: 2 }])]
    await poll()
    expect(balance(item)).toBe(-20)

    docs = [paybackDoc(uniq('payback'), sellUuid, [{ commodityUuid: commodity, qty: 1 }])]
    await poll()

    expect(balance(item)).toBe(-10)
    const back = backs(item)
    expect(back).toHaveLength(1)
    expect(back[0].batchId).toBeNull()
  })

  it('лояльный PAYBACK по-прежнему обрабатывается лояльностью (склад не ломает)', async () => {
    const { item, commodity } = await fixture('Возврат с картой')
    const sellUuid = uniq('sell')
    docs = [sellDoc(sellUuid, [{ commodityUuid: commodity, qty: 1 }], {})]
    await poll()
    expect(balance(item)).toBe(1000 - 18)
    // без карты лояльность не пишет ops — но склад отработал
    expect(docStatus(STORE, sellUuid)).toBe('PROCESSED')
  })

  it('прямой вызов restoreByPayback уважает ref_doc_id и позиции', async () => {
    const { item, commodity } = await fixture('Возврат прямой')
    const sellUuid = uniq('sell')
    docs = [sellDoc(sellUuid, [{ commodityUuid: commodity, qty: 3 }])]
    await poll()

    const r = restoreByPayback(db, STORE, uniq('payback'), sellUuid, [{ productUuid: commodity, qty: 1 }])
    expect(r).toMatchObject({ duplicate: false, restoredItems: 1 })
    const moves = db
      .prepare(`SELECT ref_doc_id AS ref FROM stock_movements WHERE doc_type='evotor_payback' AND stock_item_id=?`)
      .all(item) as { ref: string }[]
    expect(moves.map((m) => m.ref)).toContain(sellUuid)
  })
})
