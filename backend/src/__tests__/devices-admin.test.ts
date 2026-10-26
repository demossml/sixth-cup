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

async function localStore(name: string) {
  const org = await call('POST', '/organizations', {
    name: `Юрлицо-${name}`, legalName: `ООО «${name}»`, inn: '7701234567', taxRegime: 'usn_income', vatRate: 0, active: true,
  })
  const store = await call('POST', '/stores', { name: `Точка-${name}`, address: 'ул. Тест, 1', organizationId: org.json.id })
  return store.json.id as number
}

describe('admin devices (R-05)', () => {
  it('создаёт устройство с кодом регистрации и показывает его владельцу', async () => {
    const storeId = await localStore('dev-1')
    const created = await call('POST', '/devices', { storeId, name: 'Касса-1' })
    expect(created.status).toBe(200)
    expect(String(created.json.enrollCode)).toMatch(/^[0-9A-F]{8}$/)

    const list = await call('GET', '/devices')
    const row = list.json.devices.find((d: any) => d.id === created.json.id)
    expect(row.name).toBe('Касса-1')
    expect(row.enrollCode).toBe(created.json.enrollCode)
    expect(row.enrolled).toBe(0)
    expect(row.revoked).toBe(0)
  })

  it('enroll на кассе гасит код и выдаёт токен', async () => {
    const storeId = await localStore('dev-2')
    const created = await call('POST', '/devices', { storeId, name: 'Касса-2' })
    const code = created.json.enrollCode as string

    const enroll = await app.request('/api/devices/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, publicKey: 'test-key' }),
    })
    expect(enroll.status).toBe(200)
    const enrolled = (await enroll.json()) as any
    expect(enrolled.deviceToken).toBeTruthy()

    const list = await call('GET', '/devices')
    const row = list.json.devices.find((d: any) => d.id === created.json.id)
    expect(row.enrolled).toBe(1)
    expect(row.enrollCode).toBeNull()
  })

  it('revoke помечает устройство, повтор → 404 на несуществующем', async () => {
    const storeId = await localStore('dev-3')
    const created = await call('POST', '/devices', { storeId, name: 'Касса-3' })
    expect((await call('POST', `/devices/${created.json.id}/revoke`)).status).toBe(200)

    const list = await call('GET', '/devices')
    expect(list.json.devices.find((d: any) => d.id === created.json.id).revoked).toBe(1)
    expect((await call('POST', '/devices/999999/revoke')).status).toBe(404)
  })

  it('DELETE удаляет, несуществующее → 404; без токена → 403', async () => {
    const storeId = await localStore('dev-4')
    const created = await call('POST', '/devices', { storeId, name: 'Касса-4' })
    expect((await call('DELETE', `/devices/${created.json.id}`)).status).toBe(200)
    expect((await call('DELETE', `/devices/${created.json.id}`)).status).toBe(404)
    expect((await app.request('/api/admin/devices', { method: 'GET' })).status).toBe(403)
  })

  it('создание с несуществующей точкой → 404', async () => {
    expect((await call('POST', '/devices', { storeId: 999999, name: 'Касса-X' })).status).toBe(404)
  })
})
