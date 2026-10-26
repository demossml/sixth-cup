import { describe, expect, it } from 'vitest'
import { app } from '../app'
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

describe('stock items edit/delete + inventory overview (R-08/R-09)', () => {
  it('PATCH правит позицию, DELETE без ссылок удаляет', async () => {
    const created = await call('POST', '/stock/items', { name: 'Позиция-правка', unit: 'g', minQty: 5 })
    const id = created.json.id as number

    expect((await call('PATCH', `/stock/items/${id}`, { name: 'Позиция-после-правки', minQty: 12, sku: 'SKU-1' })).status).toBe(200)
    const items = await call('GET', '/stock/items?active=1')
    const row = items.json.items.find((i: any) => i.id === id)
    expect(row.name).toBe('Позиция-после-правки')
    expect(row.minQty).toBe(12)

    const del = await call('DELETE', `/stock/items/${id}`)
    expect(del.status).toBe(200)
    expect(del.json.deleted).toBe(true)
    expect((await call('DELETE', `/stock/items/${id}`)).status).toBe(404)
    expect((await call('PATCH', '/stock/items/999999', { name: 'X' })).status).toBe(404)
  })

  it('DELETE позиции с движениями выключает её и объясняет причину', async () => {
    const s = await call('POST', '/suppliers', { name: 'Поставщик-склад' })
    const item = await call('POST', '/stock/items', { name: 'Позиция-с-движением', unit: 'g' })
    const order = await call('POST', '/purchases/orders', {
      supplierId: s.json.id,
      lines: [{ stockItemId: item.json.id, qty: 3, priceKop: 100 }],
    })
    await call('PATCH', `/purchases/orders/${order.json.id}`, { status: 'confirmed' })
    const inv = await call('POST', `/purchases/orders/${order.json.id}/to-invoice`)
    await call('POST', `/purchases/invoices/${inv.json.invoiceId}/post`)

    const del = await call('DELETE', `/stock/items/${item.json.id}`)
    expect(del.status).toBe(200)
    expect(del.json.deactivated).toBe(true)
    expect(String(del.json.reason)).toMatch(/движения|накладные/)
    expect(del.json.reasonCode).toBe('has_linked_documents')
    expect(Object.keys(del.json.linked).length).toBeGreaterThan(0)

    const all = await call('GET', '/stock/items')
    const row = all.json.items.find((i: any) => i.id === item.json.id)
    expect(row).toBeTruthy()
    expect(row.active).toBe(0)
  })

  it('inventory overview отдаёт счётчики посчитанных строк', async () => {
    const item = await call('POST', '/stock/items', { name: 'Позиция-инв', unit: 'g' })
    const doc = await call('POST', '/inventory', { kind: 'partial', stockItemIds: [item.json.id] })
    expect(doc.status).toBe(201)
    const id = doc.json.id as number

    const before = await call('GET', '/inventory/overview')
    const row = before.json.docs.find((d: any) => d.id === id)
    expect(row.total).toBe(1)
    expect(row.counted).toBe(0)

    await call('PATCH', `/inventory/${id}/lines`, { lines: [{ stockItemId: item.json.id, factQty: 7 }] })
    const after = await call('GET', '/inventory/overview')
    const row2 = after.json.docs.find((d: any) => d.id === id)
    expect(row2.counted).toBe(1)
  })

  it('overview не перехватывается маршрутом /inventory/:id', async () => {
    const res = await call('GET', '/inventory/overview')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.json.docs)).toBe(true)
  })
})
