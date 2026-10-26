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

describe('suppliers: edit and delete (R-03)', () => {
  it('PATCH меняет название и реквизиты', async () => {
    const created = await call('POST', '/suppliers', { name: 'ООО Опечатка', inn: '7700000000' })
    const id = created.json.id as number

    const patch = await call('PATCH', `/suppliers/${id}`, {
      name: 'ООО Правильно',
      inn: '7711111111',
      contact: 'Иван',
      bankDetails: 'р/с 40702810000000000001',
      paymentDelayDays: 10,
    })
    expect(patch.status).toBe(200)

    const list = await call('GET', '/suppliers')
    const row = list.json.suppliers.find((s: any) => s.id === id)
    expect(row.name).toBe('ООО Правильно')
    expect(row.inn).toBe('7711111111')
    expect(row.contact).toBe('Иван')
    expect(row.bankDetails).toBe('р/с 40702810000000000001')
    expect(row.paymentDelayDays).toBe(10)
  })

  it('PATCH несуществующего → 404, пустое имя → 400', async () => {
    expect((await call('PATCH', '/suppliers/999999', { name: 'X' })).status).toBe(404)
    const created = await call('POST', '/suppliers', { name: 'Проверка-имени' })
    expect((await call('PATCH', `/suppliers/${created.json.id}`, { name: '' })).status).toBe(400)
  })

  it('DELETE без документов удаляет физически', async () => {
    const created = await call('POST', '/suppliers', { name: 'ООО Пустой' })
    const del = await call('DELETE', `/suppliers/${created.json.id}`)
    expect(del.status).toBe(200)
    expect(del.json.deleted).toBe(true)
    const list = await call('GET', '/suppliers')
    expect(list.json.suppliers.some((s: any) => s.id === created.json.id)).toBe(false)
  })

  it('DELETE с документами выключает поставщика и не отдаёт 500', async () => {
    const s = await call('POST', '/suppliers', { name: 'ООО С-документами' })
    const item = await call('POST', '/stock/items', { name: 'Сырьё-док', unit: 'g' })
    const order = await call('POST', '/purchases/orders', {
      supplierId: s.json.id,
      lines: [{ stockItemId: item.json.id, qty: 1, priceKop: 1000 }],
    })
    await call('PATCH', `/purchases/orders/${order.json.id}`, { status: 'confirmed' })
    const inv = await call('POST', `/purchases/orders/${order.json.id}/to-invoice`)
    await call('POST', `/purchases/invoices/${inv.json.invoiceId}/post`)

    const del = await call('DELETE', `/suppliers/${s.json.id}`)
    expect(del.status).toBe(200)
    expect(del.json.deactivated).toBe(true)
    expect(String(del.json.reason)).toMatch(/накладные/)

    const list = await call('GET', '/suppliers')
    const row = list.json.suppliers.find((x: any) => x.id === s.json.id)
    expect(row).toBeTruthy()
    expect(row.active).toBe(0)
  })

  it('DELETE несуществующего → 404', async () => {
    expect((await call('DELETE', '/suppliers/999999')).status).toBe(404)
  })
})
