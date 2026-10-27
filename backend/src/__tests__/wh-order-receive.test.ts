/**
 * M-03 / D-17, D-18: `received_qty` заказа растёт при проведении накладной,
 * а не при её создании; поддерживается частичная приёмка.
 */
import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin, createItem, createSupplier } from './wh-helpers'

async function order(qty: number) {
  const supplierId = await createSupplier(`Пост заказ ${Math.random().toString(16).slice(2, 8)}`)
  const item = await createItem(`Сырьё заказа ${supplierId}`, 'g')
  const created = await admin('POST', '/purchases/orders', {
    supplierId,
    lines: [{ stockItemId: item, qty, priceKop: 1000 }],
  })
  expect(created.status).toBe(201)
  const orderId = created.json.id as number
  expect((await admin('PATCH', `/purchases/orders/${orderId}`, { status: 'confirmed' })).status).toBe(200)
  const line = db
    .prepare(`SELECT id, received_qty AS received FROM purchase_order_lines WHERE order_id=?`)
    .get(orderId) as { id: number; received: number }
  return { supplierId, item, orderId, lineId: line.id }
}

const orderRow = (orderId: number) =>
  db.prepare(`SELECT status FROM purchase_orders WHERE id=?`).get(orderId) as { status: string }

const received = (lineId: number) =>
  Number(
    (db.prepare(`SELECT received_qty AS r FROM purchase_order_lines WHERE id=?`).get(lineId) as { r: number }).r,
  )

describe('M-03: приёмка заказа по проведению накладной', () => {
  it('полный цикл: to-invoice не меняет заказ, post закрывает его', async () => {
    const { orderId, lineId } = await order(10)

    const inv = await admin('POST', `/purchases/orders/${orderId}/to-invoice`)
    expect(inv.status).toBe(201)
    expect(received(lineId)).toBe(0)
    expect(orderRow(orderId).status).not.toBe('closed')

    expect((await admin('POST', `/purchases/invoices/${inv.json.invoiceId}/post`)).status).toBe(200)
    expect(received(lineId)).toBe(10)
    expect(orderRow(orderId).status).toBe('closed')
  })

  it('частичная приёмка: 4 из 10 → partial, затем остаток → closed', async () => {
    const { orderId, lineId } = await order(10)

    const first = await admin('POST', `/purchases/orders/${orderId}/to-invoice`, { lines: [{ lineId, qty: 4 }] })
    expect(first.status).toBe(201)
    expect((await admin('POST', `/purchases/invoices/${first.json.invoiceId}/post`)).status).toBe(200)
    expect(received(lineId)).toBe(4)
    expect(orderRow(orderId).status).toBe('partial')

    const second = await admin('POST', `/purchases/orders/${orderId}/to-invoice`)
    expect(second.status).toBe(201)
    const invLine = db
      .prepare(`SELECT qty FROM purchase_invoice_lines WHERE invoice_id=?`)
      .get(second.json.invoiceId) as { qty: number }
    expect(invLine.qty).toBe(6)

    expect((await admin('POST', `/purchases/invoices/${second.json.invoiceId}/post`)).status).toBe(200)
    expect(received(lineId)).toBe(10)
    expect(orderRow(orderId).status).toBe('closed')
  })

  it('удаление черновика накладной не двигает заказ и разрешает новый to-invoice', async () => {
    const { orderId, lineId } = await order(5)
    const inv = await admin('POST', `/purchases/orders/${orderId}/to-invoice`)
    expect(inv.status).toBe(201)

    expect((await admin('DELETE', `/purchases/invoices/${inv.json.invoiceId}`)).status).toBe(200)
    expect(received(lineId)).toBe(0)

    const again = await admin('POST', `/purchases/orders/${orderId}/to-invoice`)
    expect(again.status).toBe(201)
  })

  it('второй to-invoice при существующем черновике отклоняется', async () => {
    const { orderId } = await order(3)
    expect((await admin('POST', `/purchases/orders/${orderId}/to-invoice`)).status).toBe(201)
    const second = await admin('POST', `/purchases/orders/${orderId}/to-invoice`)
    expect(second.status).toBe(400)
    expect(second.json.error ?? second.json.message).toMatch(/черновик/i)
  })

  it('количество больше остатка строки отклоняется', async () => {
    const { orderId, lineId } = await order(5)
    const r = await admin('POST', `/purchases/orders/${orderId}/to-invoice`, { lines: [{ lineId, qty: 7 }] })
    expect(r.status).toBe(400)
    expect(r.json.error ?? r.json.message).toMatch(/больше остатка/i)
  })

  it('накладная без заказа проводится как раньше', async () => {
    const supplierId = await createSupplier('Пост прямой накладной')
    const item = await createItem('Сырьё прямой накладной', 'g')
    const inv = await admin('POST', '/purchases/invoices', {
      supplierId,
      lines: [{ stockItemId: item, qty: 2, unitCostKop: 500 }],
    })
    expect(inv.status).toBe(201)
    const posted = await admin('POST', `/purchases/invoices/${inv.json.id}/post`)
    expect(posted.status).toBe(200)
    const invRow = db.prepare(`SELECT order_id AS orderId FROM purchase_invoices WHERE id=?`).get(inv.json.id) as {
      orderId: number | null
    }
    expect(invRow.orderId).toBeNull()
  })
})
