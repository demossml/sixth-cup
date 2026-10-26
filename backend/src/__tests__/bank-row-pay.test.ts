import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { db } from '../db'
import { config } from '../config'

const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const call = async (m: string, p: string, body?: unknown) => {
  const r = await app.request(`/api/admin${p}`, {
    method: m,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any }
}

/** Поставщик + складская позиция + проведённая накладная на сумму totalKop. */
async function invoiceFixture(name: string, totalKop: number) {
  const s = await call('POST', '/suppliers', { name })
  const item = await call('POST', '/stock/items', { name: `${name}-сырьё`, unit: 'g' })
  const order = await call('POST', '/purchases/orders', {
    supplierId: s.json.id,
    lines: [{ stockItemId: item.json.id, qty: 1, priceKop: totalKop }],
  })
  await call('PATCH', `/purchases/orders/${order.json.id}`, { status: 'confirmed' })
  const inv = await call('POST', `/purchases/orders/${order.json.id}/to-invoice`)
  const invoiceId = inv.json.invoiceId as number
  const posted = await call('POST', `/purchases/invoices/${invoiceId}/post`)
  expect(posted.status).toBe(200)
  return { supplierId: s.json.id as number, invoiceId }
}

async function bankRow(amountKop: number, party = 'ООО Выписка') {
  const imp = await call('POST', '/purchases/bank-rows', {
    rows: [{ dateAt: Date.now(), party, purpose: 'оплата по счёту', amountKop }],
  })
  const list = await call('GET', '/purchases/bank-rows')
  return list.json.rows.find((r: any) => r.amountKop === amountKop && r.party === party) as { id: number }
}

const paidKop = (invoiceId: number) =>
  (db.prepare('SELECT paid_kop AS p FROM purchase_invoices WHERE id=?').get(invoiceId) as { p: number }).p

const paymentCount = () =>
  (db.prepare('SELECT COUNT(*) AS n FROM purchase_payments').get() as { n: number }).n

describe('POST /purchases/bank-rows/:id/pay', () => {
  beforeAll(() => {
    expect(db.prepare('PRAGMA table_info(bank_rows)').all().some((c: any) => c.name === 'payment_id')).toBe(true)
  })

  it('создаёт платёж, распределяет его и уменьшает долг', async () => {
    const { invoiceId } = await invoiceFixture('Выписка-оплата', 50000)
    const row = await bankRow(30000)
    expect((await call('PATCH', `/purchases/bank-rows/${row.id}`, { invoiceId })).status).toBe(200)
    expect(paidKop(invoiceId)).toBe(0)

    const res = await call('POST', `/purchases/bank-rows/${row.id}/pay`)
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    expect(res.json.paymentId).toBeGreaterThan(0)
    expect(res.json.idempotent).toBeUndefined()
    expect(paidKop(invoiceId)).toBe(30000)

    const rows = await call('GET', '/purchases/bank-rows')
    const saved = rows.json.rows.find((r: any) => r.id === row.id)
    expect(saved.paymentId).toBe(res.json.paymentId)
    expect(saved.paid).toBe(true)

    const debt = await call('GET', '/purchases/debt')
    const entry = debt.json.debts.find((d: any) => d.debtKop === 20000)
    expect(entry, JSON.stringify(debt.json)).toBeTruthy()
  })

  it('повторный вызов идемпотентен — второй платёж не создаётся', async () => {
    const { invoiceId } = await invoiceFixture('Выписка-идемпотент', 40000)
    const row = await bankRow(40000)
    await call('PATCH', `/purchases/bank-rows/${row.id}`, { invoiceId })

    const before = paymentCount()
    const first = await call('POST', `/purchases/bank-rows/${row.id}/pay`)
    const second = await call('POST', `/purchases/bank-rows/${row.id}/pay`)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.json.idempotent).toBe(true)
    expect(second.json.paymentId).toBe(first.json.paymentId)
    expect(paymentCount()).toBe(before + 1)
    expect(paidKop(invoiceId)).toBe(40000)
  })

  it('без привязанной накладной — 400', async () => {
    const row = await bankRow(12345, 'ООО Без накладной')
    const res = await call('POST', `/purchases/bank-rows/${row.id}/pay`)
    expect(res.status).toBe(400)
    expect(res.json.error).toMatch(/накладн/i)
  })

  it('чужая накладная и черновик — 400', async () => {
    const mine = await invoiceFixture('Выписка-своя', 10000)
    const other = await invoiceFixture('Выписка-чужая', 10000)

    const rowWrong = await bankRow(5000, 'ООО Чужак')
    await call('PATCH', `/purchases/bank-rows/${rowWrong.id}`, { invoiceId: other.invoiceId })
    // Строка «своя» по поставщику, накладная — другого: платёж запрещён.
    db.prepare('UPDATE bank_rows SET supplier_id=? WHERE id=?').run(mine.supplierId, rowWrong.id)
    expect((await call('POST', `/purchases/bank-rows/${rowWrong.id}/pay`)).status).toBe(400)

    // Черновик нельзя оплатить.
    const s = await call('POST', '/suppliers', { name: 'Выписка-черновик' })
    const item = await call('POST', '/stock/items', { name: 'Черновик-сырьё', unit: 'g' })
    const order = await call('POST', '/purchases/orders', {
      supplierId: s.json.id,
      lines: [{ stockItemId: item.json.id, qty: 1, priceKop: 7000 }],
    })
    await call('PATCH', `/purchases/orders/${order.json.id}`, { status: 'confirmed' })
    const draft = await call('POST', `/purchases/orders/${order.json.id}/to-invoice`)
    const rowDraft = await bankRow(7000, 'ООО Черновик')
    await call('PATCH', `/purchases/bank-rows/${rowDraft.id}`, { invoiceId: draft.json.invoiceId })
    expect((await call('POST', `/purchases/bank-rows/${rowDraft.id}/pay`)).status).toBe(400)
  })

  it('распределение больше суммы строки и больше долга — 400', async () => {
    const { invoiceId } = await invoiceFixture('Выписка-перелив', 20000)
    const row = await bankRow(5000, 'ООО Перелив')
    await call('PATCH', `/purchases/bank-rows/${row.id}`, { invoiceId })

    const over = await call('POST', `/purchases/bank-rows/${row.id}/pay`, {
      allocations: [{ invoiceId, amountKop: 9000 }],
    })
    expect(over.status).toBe(400)

    const overDebt = await call('POST', `/purchases/bank-rows/${row.id}/pay`, {
      allocations: [{ invoiceId, amountKop: 20001 }],
    })
    expect(overDebt.status).toBe(400)

    // Частичная оплата в пределах долга проходит.
    const ok = await call('POST', `/purchases/bank-rows/${row.id}/pay`, {
      allocations: [{ invoiceId, amountKop: 4000 }],
    })
    expect(ok.status).toBe(200)
    expect(paidKop(invoiceId)).toBe(4000)
  })

  it('нет строки — 404, нет токена — 403', async () => {
    expect((await call('POST', '/purchases/bank-rows/999999/pay')).status).toBe(404)
    const anon = await app.request('/api/admin/purchases/bank-rows/1/pay', { method: 'POST' })
    expect(anon.status).toBe(403)
  })

  it('строка без остатка долга (уже оплачена) — 400 без второго платежа', async () => {
    const { invoiceId } = await invoiceFixture('Выписка-полностью', 15000)
    const row = await bankRow(15000, 'ООО Полностью')
    await call('PATCH', `/purchases/bank-rows/${row.id}`, { invoiceId })
    expect((await call('POST', `/purchases/bank-rows/${row.id}/pay`)).status).toBe(200)

    const second = await bankRow(15000, 'ООО Повтор')
    await call('PATCH', `/purchases/bank-rows/${second.id}`, { invoiceId })
    expect((await call('POST', `/purchases/bank-rows/${second.id}/pay`)).status).toBe(400)
    expect(paidKop(invoiceId)).toBe(15000)
  })
})
