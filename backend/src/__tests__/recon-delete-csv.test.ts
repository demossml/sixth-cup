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
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any, text: '' }
}
const raw = (p: string) => app.request(`/api/admin${p}`, { headers: H })

async function reconFixture(name: string, totalKop: number) {
  const s = await call('POST', '/suppliers', { name })
  const item = await call('POST', '/stock/items', { name: `${name}-сырьё`, unit: 'g' })
  const order = await call('POST', '/purchases/orders', {
    supplierId: s.json.id,
    lines: [{ stockItemId: item.json.id, qty: 1, priceKop: totalKop }],
  })
  await call('PATCH', `/purchases/orders/${order.json.id}`, { status: 'confirmed' })
  const inv = await call('POST', `/purchases/orders/${order.json.id}/to-invoice`)
  await call('POST', `/purchases/invoices/${inv.json.invoiceId}/post`)
  const rec = await call('POST', '/purchases/reconciliations', {
    supplierId: s.json.id,
    periodFrom: Date.now() - 86_400_000,
    periodTo: Date.now() + 86_400_000,
    notes: 'акт за период',
  })
  return { supplierId: s.json.id as number, reconId: rec.json.id as number }
}

describe('reconciliations: delete + csv', () => {
  it('удаляет сверку и отдаёт 404 на повтор', async () => {
    const { reconId } = await reconFixture('Сверка-удаление', 25000)

    const before = await call('GET', '/purchases/reconciliations')
    expect(before.json.reconciliations.some((r: any) => r.id === reconId)).toBe(true)

    const del = await call('DELETE', `/purchases/reconciliations/${reconId}`)
    expect(del.status).toBe(200)
    expect(del.json.ok).toBe(true)

    const after = await call('GET', '/purchases/reconciliations')
    expect(after.json.reconciliations.some((r: any) => r.id === reconId)).toBe(false)

    expect((await call('DELETE', `/purchases/reconciliations/${reconId}`)).status).toBe(404)
  })

  it('невалидный id → 400, без токена → 403', async () => {
    expect((await call('DELETE', '/purchases/reconciliations/abc')).status).toBe(400)
    const anon = await app.request('/api/admin/purchases/reconciliations/1', { method: 'DELETE' })
    expect(anon.status).toBe(403)
  })

  it('CSV содержит BOM, шапку и цифры сверки', async () => {
    const { reconId, supplierId } = await reconFixture('Сверка-csv', 30000)
    await call('PATCH', `/purchases/reconciliations/${reconId}`, { theirBalanceKop: 10000, status: 'sent' })

    const res = await raw(`/purchases/reconciliations/${reconId}.csv`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain(`reconciliation-${reconId}.csv`)

    // Response.text() срезает BOM, поэтому проверяем байты.
    const bytes = new Uint8Array(await res.clone().arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    const text = await res.text()
    expect(text).toContain('Показатель;Значение')
    expect(text).toContain('Сверка-csv')
    // Заголовок с запятой и суммы в русской локали попадают в кавычки.
    expect(text).toContain('"Оборот, ₽";"300,00"')
    expect(text).toContain('"Наш долг, ₽";"300,00"')
    expect(text).toContain('"По данным поставщика, ₽";"100,00"')
    // toCsv защищает от формул-инъекций: строка, начинающаяся с «-», получает апостроф.
    // Это поведение общее для operations.csv/products.csv, поэтому здесь проверяем как есть.
    expect(text).toContain('"Расхождение, ₽";"\'-200,00"')
    expect(text).toContain('Статус;sent')
    expect(supplierId).toBeGreaterThan(0)
  })

  it('CSV несуществующей сверки → 404', async () => {
    const res = await raw('/purchases/reconciliations/999999.csv')
    expect(res.status).toBe(404)
  })
})
