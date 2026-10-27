/**
 * M-01 / D-16: платёж по накладной не может превысить её долг.
 */
import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin, createItem, createSupplier, receive } from './wh-helpers'

const paidOf = (invoiceId: number) =>
  Number((db.prepare('SELECT paid_kop AS p FROM purchase_invoices WHERE id=?').get(invoiceId) as { p: number }).p)

const paymentsCount = (supplierId: number) =>
  Number(
    (db.prepare('SELECT COUNT(*) AS n FROM purchase_payments WHERE supplier_id=?').get(supplierId) as { n: number }).n,
  )

async function invoice(totalKop: number) {
  const supplierId = await createSupplier(`Пост оплат ${totalKop}-${Math.random().toString(16).slice(2, 8)}`)
  const item = await createItem(`Сырьё оплат ${supplierId}`, 'g')
  const id = await receive(supplierId, [{ stockItemId: item, qty: 1, unitCostKop: totalKop }])
  return { supplierId, invoiceId: id }
}

const pay = (supplierId: number, invoiceId: number, amountKop: number) =>
  admin('POST', '/purchases/payments', {
    supplierId,
    amountKop,
    allocations: [{ invoiceId, amountKop }],
  })

describe('M-01: лимит платежа по долгу накладной', () => {
  it('платёж больше долга отклоняется, частичный проходит', async () => {
    const { supplierId, invoiceId } = await invoice(100_000)

    expect((await pay(supplierId, invoiceId, 60_000)).status).toBe(201)
    const over = await pay(supplierId, invoiceId, 60_000)
    expect(over.status).toBe(400)
    expect(over.json.error ?? over.json.message).toMatch(/больше долга/i)

    expect(paidOf(invoiceId)).toBe(60_000)
    expect(paymentsCount(supplierId)).toBe(1)
  })

  it('остаток ровно в долг проходит и закрывает долг', async () => {
    const { supplierId, invoiceId } = await invoice(100_000)
    expect((await pay(supplierId, invoiceId, 60_000)).status).toBe(201)
    expect((await pay(supplierId, invoiceId, 40_000)).status).toBe(201)
    expect(paidOf(invoiceId)).toBe(100_000)

    const debt = await admin('GET', '/purchases/debt')
    const row = (debt.json.rows ?? debt.json.debts ?? []).find((r: any) => r.supplierId === supplierId)
    expect(row?.debtKop ?? 0).toBe(0)
  })

  it('две аллокации на одну накладную суммируются при проверке', async () => {
    const { supplierId, invoiceId } = await invoice(100_000)
    const r = await admin('POST', '/purchases/payments', {
      supplierId,
      amountKop: 120_000,
      allocations: [
        { invoiceId, amountKop: 60_000 },
        { invoiceId, amountKop: 60_000 },
      ],
    })
    expect(r.status).toBe(400)
    expect(paidOf(invoiceId)).toBe(0)
    expect(paymentsCount(supplierId)).toBe(0)
  })

  it('накладная другого поставщика и черновик по-прежнему отклоняются', async () => {
    const a = await invoice(50_000)
    const b = await invoice(50_000)
    const foreign = await pay(a.supplierId, b.invoiceId, 1000)
    expect(foreign.status).toBe(400)
    expect(foreign.json.error ?? foreign.json.message).toMatch(/другого поставщика/i)

    const draftInv = await admin('POST', '/purchases/invoices', {
      supplierId: a.supplierId,
      lines: [{ stockItemId: 1, qty: 1, unitCostKop: 100 }],
    })
    if (draftInv.status === 201) {
      const r = await pay(a.supplierId, draftInv.json.id, 100)
      expect(r.status).toBe(400)
      expect(r.json.error ?? r.json.message).toMatch(/проведённым/i)
    }
  })
})
