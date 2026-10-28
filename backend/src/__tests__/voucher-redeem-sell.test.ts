/**
 * Блок E: гашение ваучера в основном потоке Эвотора (`handleSell` + `sc.voucherId`).
 * Гасит только QR-карта; невалидный ваучер — спор, а не падение продажи;
 * повторный poll идемпотентен; multi соблюдает суточный и общий лимиты.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-vredeem-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { db } = await import('../db')
const { ensureCard, buildCardProof } = await import('../modules/loyalty/proof')
const { resolveAndReserve } = await import('../modules/loyalty/reservations')
const { handleSell } = await import('../integrations/evotor/processing/SellHandler')
const { createTemplate, grantVoucher } = await import('../modules/vouchers/service')

const STORE = 'store-vou'
const COMMODITY = 'p-vou-latte'
const APP = '151071e8-88a4-44f6-b71a-b17c559f9b7d'

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`

function guest(paidTotal = 4): { id: number; code: string; proof: string } {
  const code = String(6000 + ++seq)
  db.prepare('INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)')
    .run(`vou-${code}`, `+7600${code}`, `VOU${code}`, `CARD-${code}`, code, Date.now())
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  ensureCard(id)
  db.prepare('UPDATE cards SET paid_total=? WHERE user_id=?').run(paidTotal, id)
  return { id, code, proof: buildCardProof(id) }
}

const sell = (docId: string, c: string, opts: { free?: number; op?: string; voucherId?: number } = {}) => ({
  uuid: docId,
  type: 'SELL',
  closeDate: new Date().toISOString(),
  extras: {
    [APP]: {
      sc: {
        v: 2, c, op: opts.op, free: opts.free ?? 0, cb: 0, ts: 1,
        ...(opts.voucherId ? { voucherId: opts.voucherId } : {}),
      },
    },
  },
  transactions: [{ type: 'REGISTER_POSITION', commodityUuid: COMMODITY, quantity: 1, price: 30000 }],
  closeSum: '30000',
})

const voucherRow = (id: number) =>
  db.prepare('SELECT used_at AS usedAt, receipt_id AS receiptId, redemptions_count AS count FROM vouchers WHERE id=?')
    .get(id) as { usedAt: number | null; receiptId: string | null; count: number }
const voucherIdFor = (userId: number) =>
  (db.prepare('SELECT MAX(id) AS id FROM vouchers WHERE user_id=?').get(userId) as { id: number | null }).id!
const disputes = (receiptId: string) =>
  db.prepare('SELECT kind, details FROM disputes WHERE receipt_id=?').all(receiptId) as { kind: string; details: string }[]

beforeEach(() => {
  db.prepare("INSERT OR REPLACE INTO products(id,name,price,counts_as_cup) VALUES(960,'Latte',300,1)").run()
  db.prepare('INSERT OR IGNORE INTO product_store_links(product_id,store_uuid,evotor_uuid) VALUES(960,?,?)')
    .run(STORE, COMMODITY)
})

describe('E3: гашение ваучера в handleSell', () => {
  it('QR + валидный once → used_at и receipt_id установлены', () => {
    createTemplate({ code: 'E-ONCE', title: 'Кофе в подарок', kind: 'fixed', value: 300, validDays: 10 })
    const g = guest()
    grantVoucher(g.id, 'E-ONCE')
    const vid = voucherIdFor(g.id)
    const docId = uniq('sell')

    expect(handleSell(db as any, STORE, sell(docId, g.proof, { voucherId: vid })).processed).toBe(true)
    const row = voucherRow(vid)
    expect(row.usedAt).toBeTruthy()
    expect(row.receiptId).toBe(docId)
    expect(disputes(docId).some((d) => d.kind === 'voucher_not_redeemed')).toBe(false)
    const op = db.prepare('SELECT voucher FROM loyalty_ops WHERE doc_id=?').get(docId) as { voucher: string }
    expect(op.voucher).toBe(`v:${vid}`)
  })

  it('повторный poll того же чека не гасит ваучер второй раз', () => {
    createTemplate({ code: 'E-ONCE-2', title: 'Одноразовый', kind: 'fixed', value: 100, validDays: 10 })
    const g = guest()
    grantVoucher(g.id, 'E-ONCE-2')
    const vid = voucherIdFor(g.id)
    const docId = uniq('sell')

    handleSell(db as any, STORE, sell(docId, g.proof, { voucherId: vid }))
    const first = voucherRow(vid)
    handleSell(db as any, STORE, sell(docId, g.proof, { voucherId: vid }))
    const second = voucherRow(vid)
    expect(second.usedAt).toBe(first.usedAt)
    expect(second.receiptId).toBe(first.receiptId)
    const logs = (db.prepare('SELECT COUNT(*) AS n FROM voucher_redemptions WHERE voucher_id=?').get(vid) as { n: number }).n
    expect(logs).toBe(1)
  })

  it('чужой voucherId → спор, остальная лояльность применяется', () => {
    createTemplate({ code: 'E-FOREIGN', title: 'Чужой', kind: 'fixed', value: 100, validDays: 10 })
    const owner = guest()
    grantVoucher(owner.id, 'E-FOREIGN')
    const vid = voucherIdFor(owner.id)
    const stranger = guest()
    const docId = uniq('sell')

    handleSell(db as any, STORE, sell(docId, stranger.proof, { voucherId: vid }))
    expect(voucherRow(vid).usedAt).toBeNull()
    const d = disputes(docId).find((x) => x.kind === 'voucher_not_redeemed')
    expect(d).toBeTruthy()
    expect(JSON.parse(d!.details).reason).toBe('voucher_foreign')
    // продажа учтена: платная чашка начислена
    const st = db.prepare('SELECT paid_total AS paid FROM cards WHERE user_id=?').get(stranger.id) as { paid: number }
    expect(st.paid).toBe(5)
  })

  it('multi с max_per_day=1 → второе гашение в тот же день отклонено', () => {
    createTemplate({
      code: 'E-MULTI', title: 'Многоразовый', kind: 'fixed', value: 100, validDays: 10,
      redemptionMode: 'multi', maxPerDay: 1,
    })
    const g = guest()
    grantVoucher(g.id, 'E-MULTI')
    const vid = voucherIdFor(g.id)

    const d1 = uniq('sell')
    handleSell(db as any, STORE, sell(d1, g.proof, { voucherId: vid }))
    expect(voucherRow(vid).count).toBe(1)

    const d2 = uniq('sell')
    handleSell(db as any, STORE, sell(d2, g.proof, { voucherId: vid }))
    expect(voucherRow(vid).count).toBe(1)
    const d = disputes(d2).find((x) => x.kind === 'voucher_not_redeemed')
    expect(JSON.parse(d!.details).reason).toBe('voucher_limit')
    // отказ не оставляет мусорной строки в журнале гашений
    const logs = (db.prepare('SELECT COUNT(*) AS n FROM voucher_redemptions WHERE voucher_id=?').get(vid) as { n: number }).n
    expect(logs).toBe(1)
  })

  it('числовой код карты не гасит ваучер', () => {
    createTemplate({ code: 'E-NUM', title: 'Только QR', kind: 'fixed', value: 100, validDays: 10 })
    const g = guest()
    grantVoucher(g.id, 'E-NUM')
    const vid = voucherIdFor(g.id)
    const docId = uniq('sell')

    handleSell(db as any, STORE, sell(docId, g.code, { voucherId: vid }))
    expect(voucherRow(vid).usedAt).toBeNull()
    const logs = (db.prepare('SELECT COUNT(*) AS n FROM voucher_redemptions WHERE voucher_id=?').get(vid) as { n: number }).n
    expect(logs).toBe(0)
  })

  it('без voucherId поведение прежнее: лояльность считается, споров о ваучере нет', () => {
    const g = guest()
    const docId = uniq('sell')
    expect(handleSell(db as any, STORE, sell(docId, g.proof)).processed).toBe(true)
    expect(disputes(docId).some((d) => d.kind.startsWith('voucher'))).toBe(false)
    const op = db.prepare('SELECT voucher FROM loyalty_ops WHERE doc_id=?').get(docId) as { voucher: string | null }
    expect(op.voucher).toBeNull()
  })

  it('stackable_with_free_cup=0 и применена бесплатная чашка → ваучер не гасится', () => {
    createTemplate({
      code: 'E-NOSTACK', title: 'Не с подарком', kind: 'fixed', value: 100, validDays: 10,
      stackableWithFreeCup: false,
    })
    const g = guest(5) // одна заработанная бесплатная чашка — иначе appliedFree = 0
    grantVoucher(g.id, 'E-NOSTACK')
    const vid = voucherIdFor(g.id)
    const r = resolveAndReserve({ code: g.proof, storeUuid: STORE, deviceUuid: 'dev-nostack' })
    const docId = uniq('sell')

    handleSell(db as any, STORE, sell(docId, g.proof, { free: 1, op: (r as any).reservationId, voucherId: vid }))
    expect(voucherRow(vid).usedAt).toBeNull()
    const d = disputes(docId).find((x) => x.kind === 'voucher_not_redeemed')
    expect(JSON.parse(d!.details).reason).toBe('voucher_not_stacked_with_free')
    // бесплатная чашка при этом списана штатно
    const st = db.prepare('SELECT free_used AS freeUsed FROM cards WHERE user_id=?').get(g.id) as { freeUsed: number }
    expect(st.freeUsed).toBe(1)
  })
})
