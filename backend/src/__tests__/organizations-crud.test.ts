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

const org = (name: string) => ({
  name,
  legalName: `ООО «${name}»`,
  inn: '7701234567',
  kpp: '770101001',
  taxRegime: 'usn_income',
  vatRate: 5,
  active: true,
})

describe('organizations CRUD (R-04)', () => {
  it('создаёт, читает, правит и удаляет юрлицо', async () => {
    const created = await call('POST', '/organizations', org('Юрлицо-А'))
    expect(created.status).toBe(200)
    const id = created.json.id as number

    const got = await call('GET', `/organizations/${id}`)
    expect(got.status).toBe(200)
    expect(got.json.organization.name).toBe('Юрлицо-А')
    expect(got.json.organization.vatRate).toBe(5)

    expect((await call('PATCH', `/organizations/${id}`, { name: 'Юрлицо-Б', vatRate: 7 })).status).toBe(200)
    const list = await call('GET', '/organizations')
    const row = list.json.organizations.find((o: any) => o.id === id)
    expect(row.name).toBe('Юрлицо-Б')
    expect(row.vatRate).toBe(7)

    expect((await call('DELETE', `/organizations/${id}`)).status).toBe(200)
    expect((await call('GET', `/organizations/${id}`)).status).toBe(404)
  })

  it('валидация: короткий ИНН → 400, пустое имя → 400', async () => {
    expect((await call('POST', '/organizations', { ...org('Плохой'), inn: '123' })).status).toBe(400)
    expect((await call('POST', '/organizations', { ...org('Пустой'), name: '' })).status).toBe(400)
  })

  it('нельзя удалить юрлицо с привязанной точкой (409)', async () => {
    const created = await call('POST', '/organizations', org('Юрлицо-с-точкой'))
    const store = await call('POST', '/stores', { name: 'Точка-юрлица', address: 'ул. Тест, 1', organizationId: created.json.id })
    expect(store.status).toBe(200)

    const del = await call('DELETE', `/organizations/${created.json.id}`)
    expect(del.status).toBe(409)
    expect(String(del.json.error)).toMatch(/точк/i)
  })
})
