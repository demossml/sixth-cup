/**
 * Сквозной дымовой сценарий склада W0–W2 на чистой БД:
 * приход → норма → продажа без карты → возврат → ручное списание → инвентаризация.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { PollService } from '../integrations/evotor/sync/PollService'
import { createToken } from '../integrations/evotor/tokenStore'
import {
  admin,
  balance,
  batchLeft,
  createItem,
  createSupplier,
  docStatus,
  paybackDoc,
  productWithNorm,
  receive,
  sellDoc,
} from './wh-helpers'

const STORE = 'store-wh-e2e'

let docs: Record<string, unknown>[] = []
const fakeClient = {
  isConfigured: true,
  getStores: async () => ({ items: [{ uuid: STORE, name: 'Точка E2E' }] }),
  getDocuments: async () => ({ items: docs }),
} as any

const poll = () => new PollService(db, fakeClient).runFast()

beforeEach(() => {
  docs = []
  db.prepare(
    `INSERT INTO evotor_stores(store_uuid, name, sync_enabled, updated_at) VALUES(?,?,1,?)
     ON CONFLICT(store_uuid) DO UPDATE SET sync_enabled=1`,
  ).run(STORE, 'Точка E2E', Date.now())
  createToken(db, { label: 'e2e', token: 'e2e-token', storeUuids: [STORE] })
})

describe('Склад W0–W2: сквозной сценарий', () => {
  it('приход → продажа → возврат → списание → инвентаризация', async () => {
    // 1. Приход 1000 г и норма 18 г на чашку
    const supplier = await createSupplier('Поставщик E2E')
    const beans = await createItem('Кофе E2E', 'g')
    await receive(supplier, [{ stockItemId: beans, qty: 1000 }], { storeUuid: STORE })
    const commodity = 'uuid-e2e-cappuccino'
    await productWithNorm(901, commodity, STORE, beans, 18)
    expect(balance(beans)).toBe(1000)

    // 2. Продажа 2 чашек БЕЗ карты — склад обязан списаться
    const sellUuid = 'e2e-sell-1'
    docs = [sellDoc(sellUuid, [{ commodityUuid: commodity, qty: 2 }])]
    await poll()
    expect(balance(beans)).toBe(1000 - 36)
    expect(docStatus(STORE, sellUuid)).toBe('PROCESSED')

    // 3. Возврат одной чашки — сырьё возвращается в партию
    docs = [paybackDoc('e2e-payback-1', sellUuid, [{ commodityUuid: commodity, qty: 1 }])]
    await poll()
    expect(balance(beans)).toBe(1000 - 18)

    // 4. Ручное списание 10 г (порча)
    const wo = await admin('POST', '/stock/writeoffs', {
      storeUuid: STORE,
      reason: 'spoilage',
      notes: 'e2e',
      lines: [{ stockItemId: beans, qty: 10 }],
    })
    expect(wo.status).toBe(201)
    expect(balance(beans)).toBe(1000 - 18 - 10)

    // 5. Инвентаризация: факт совпадает с книгой → движений нет
    const opened = balance(beans)
    const inv = await admin('POST', '/inventory', { kind: 'partial', stockItemIds: [beans], storeUuid: STORE })
    await admin('PATCH', `/inventory/${inv.json.id}/lines`, { lines: [{ stockItemId: beans, factQty: opened }] })
    expect((await admin('POST', `/inventory/${inv.json.id}/post`)).status).toBe(200)
    expect(balance(beans)).toBe(opened)

    // 6. Инвариант: движения и партии сходятся
    expect(balance(beans)).toBeCloseTo(batchLeft(beans), 6)

    // 7. Остатки через API показывают то же число
    const balances = await admin('GET', `/stock/balances?storeUuid=${STORE}`)
    const row = balances.json.balances.find((b: any) => b.id === beans)
    expect(row.expectedQty).toBe(opened)
  })
})
