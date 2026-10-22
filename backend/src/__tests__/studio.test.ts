import { describe, it, expect } from 'vitest'
import { app } from '../app'
import { config } from '../config'

const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const call = async (m: string, p: string, body?: unknown) => {
  const r = await app.request(`/api/admin${p}`, { method: m, headers: H, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any }
}

describe('studio API', () => {
  it('requires admin token', async () => {
    const r = await app.request('/api/admin/purchases/snapshot')
    expect(r.status).toBe(403)
  })

  it('read endpoints answer 200 on empty DB', async () => {
    for (const p of ['/purchases/snapshot', '/purchases/payments', '/purchases/orders', '/purchases/returns',
      '/purchases/reconciliations', '/purchases/bank-rows', '/purchases/order-helper', '/stock/recipes', '/stock/snapshot',
      '/ai/feed', '/analytics/overview', '/analytics/heatmap', '/analytics/staff', '/analytics/affinity',
      '/analytics/customers', '/analytics/compare', '/analytics/window?period=yesterday', '/analytics/window?period=7d', '/referrals/pairs?period=30d']) {
      const r = await call('GET', p)
      expect(r.status, p + ' ' + JSON.stringify(r.json)).toBe(200)
    }
  })

  it('order → invoice → post → return flow keeps ledger', async () => {
    const s = await call('POST', '/suppliers', { name: 'Тест-поставщик' })
    const it = await call('POST', '/stock/items', { name: 'Молоко-тест', unit: 'l' })
    expect(s.status).toBe(201); expect(it.status).toBe(201)
    await call('PATCH', `/suppliers/${s.json.id}/legal`, { legalName: 'ООО Тест', kpp: '1', extra: { a: 1 } })
    const o = await call('POST', '/purchases/orders', { supplierId: s.json.id, lines: [{ stockItemId: it.json.id, qty: 10, priceKop: 9000 }] })
    expect(o.status).toBe(201)
    expect((await call('POST', `/purchases/orders/${o.json.id}/to-invoice`)).status).toBe(400) // draft
    await call('PATCH', `/purchases/orders/${o.json.id}`, { status: 'confirmed' })
    const inv = await call('POST', `/purchases/orders/${o.json.id}/to-invoice`)
    expect(inv.status).toBe(201)
    expect((await call('POST', `/purchases/invoices/${inv.json.invoiceId}/post`)).status).toBe(200)
    const ret = await call('POST', '/purchases/returns', { supplierId: s.json.id, basis: 'Срок', lines: [{ stockItemId: it.json.id, qty: 4, priceKop: 9000 }] })
    expect((await call('POST', `/purchases/returns/${ret.json.id}/post`)).status).toBe(200)
    const snap = await call('GET', '/stock/snapshot')
    expect(snap.json.items.find((x: any) => x.id === it.json.id).total).toBe(6)
    const rec = await call('POST', '/purchases/reconciliations', { supplierId: s.json.id, periodFrom: 0, periodTo: Date.now() + 1000 })
    const list = await call('GET', '/purchases/reconciliations')
    const r = list.json.reconciliations.find((x: any) => x.id === rec.json.id)
    expect(r.ourBalanceKop).toBe(90000)
    const bank = await call('POST', '/purchases/bank-rows', { rows: [{ dateAt: Date.now(), party: 'Тест-поставщик', purpose: 'оплата', amountKop: -1000 }] })
    expect(bank.json.imported).toBe(1)
  })

  it('recipes + inventory extras', async () => {
    const it = await call('POST', '/stock/items', { name: 'Кофе-тест', unit: 'kg' })
    const inv = await call('POST', '/inventory', { kind: 'partial', stockItemIds: [it.json.id] })
    expect((await call('POST', `/inventory/${inv.json.id}/submit`)).status).toBe(400)
    await call('PATCH', `/inventory/${inv.json.id}/lines`, { lines: [{ stockItemId: it.json.id, factQty: 1 }] })
    expect((await call('POST', `/inventory/${inv.json.id}/recount`, { stockItemIds: [it.json.id] })).status).toBe(200)
    await call('PATCH', `/inventory/${inv.json.id}/lines`, { lines: [{ stockItemId: it.json.id, factQty: 2 }] })
    expect((await call('POST', `/inventory/${inv.json.id}/submit`)).status).toBe(200)
    expect((await call('GET', `/inventory/${inv.json.id}/sheet`)).json.doc.status).toBe('review')
    expect((await call('POST', `/inventory/${inv.json.id}/cancel`)).status).toBe(200)
  })

  it('ai hide', async () => {
    expect((await call('POST', '/ai/feed/no-norm/hide')).status).toBe(200)
    const f = await call('GET', '/ai/feed')
    expect(f.json.cards.find((c: any) => c.key === 'no-norm')).toBeUndefined()
  })
})

describe('studio routing order', () => {
  it('/inventory/overview is not swallowed by /inventory/:id', async () => {
    const r = await call('GET', '/inventory/overview')
    expect(r.status).toBe(200)
    expect(Array.isArray(r.json.docs)).toBe(true)
  })
})

describe('studio AI ask', () => {
  it('refuses with an honest message when AI is off', async () => {
    const r = await call('POST', '/ai/ask', { question: 'Что с продажами?' })
    expect([503, 403]).toContain(r.status)
  })
})
