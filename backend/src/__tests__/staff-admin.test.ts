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

describe('admin staff (R-07, R-TEST-001)', () => {
  it('создаёт сотрудника и возвращает его в списке', async () => {
    const created = await call('POST', '/staff', { name: 'Иван Петров', role: 'Бариста' })
    expect(created.status).toBe(200)
    const list = await call('GET', '/staff')
    const row = list.json.staff.find((s: any) => s.id === created.json.id)
    expect(row.name).toBe('Иван Петров')
    expect(row.role).toBe('Бариста')
    expect(row.active).toBe(1)
  })

  it('PATCH переименовывает и меняет роль, не затирая остальное', async () => {
    const created = await call('POST', '/staff', { name: 'Пётр Сидоров', role: 'Кассир' })
    const id = created.json.id as number

    expect((await call('PATCH', `/staff/${id}`, { name: 'Пётр Сидоров-мл.' })).status).toBe(200)
    let row = (await call('GET', '/staff')).json.staff.find((s: any) => s.id === id)
    expect(row.name).toBe('Пётр Сидоров-мл.')
    expect(row.role).toBe('Кассир')

    expect((await call('PATCH', `/staff/${id}`, { role: 'Старший бариста' })).status).toBe(200)
    row = (await call('GET', '/staff')).json.staff.find((s: any) => s.id === id)
    expect(row.name).toBe('Пётр Сидоров-мл.')
    expect(row.role).toBe('Старший бариста')
  })

  it('PATCH active=false скрывает сотрудника как неактивного', async () => {
    const created = await call('POST', '/staff', { name: 'Неактивный', role: 'Кассир' })
    expect((await call('PATCH', `/staff/${created.json.id}`, { active: false })).status).toBe(200)
    const row = (await call('GET', '/staff')).json.staff.find((s: any) => s.id === created.json.id)
    expect(row.active).toBe(0)
  })

  it('PATCH несуществующего → 404, пустое имя → 400, без токена → 403', async () => {
    expect((await call('PATCH', '/staff/999999', { name: 'X' })).status).toBe(404)
    const created = await call('POST', '/staff', { name: 'Проверка', role: 'Кассир' })
    expect((await call('PATCH', `/staff/${created.json.id}`, { name: '' })).status).toBe(400)
    const anon = await app.request(`/api/admin/staff/${created.json.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Взлом' }),
    })
    expect(anon.status).toBe(403)
  })

  it('PUT /staff/:id/device привязывает кассу, DELETE деактивирует', async () => {
    const created = await call('POST', '/staff', { name: 'С привязкой', role: 'Кассир' })
    const link = await call('PUT', `/staff/${created.json.id}/device`, { deviceUuid: 'device-test-uuid' })
    expect(link.status).toBe(200)
    expect((await call('PUT', '/staff/999999/device', { deviceUuid: 'x' })).status).toBe(404)

    expect((await call('DELETE', `/staff/${created.json.id}`)).status).toBe(200)
    const row = (await call('GET', '/staff')).json.staff.find((s: any) => s.id === created.json.id)
    expect(row.active).toBe(0)
  })
})
