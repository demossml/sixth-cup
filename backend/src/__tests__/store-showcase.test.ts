/**
 * Витрина точки: гость видит локальную точку (`stores`), облако живёт отдельно.
 *
 * Ключевые правила, которые нельзя сломать:
 *  • название и адрес витрины вводит владелец — синхронизация их не перезаписывает;
 *  • из облака приходят только снимки `evotor_name` / `evotor_address` (кнопка «Взять из Эвотора»);
 *  • привязка витрины к облачной точке одна (уникальный индекс), иначе заказ уйдёт не на ту кассу;
 *  • фото, ориентир и телефон — только ручные поля.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-store-showcase-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { config } = await import('../config')
const { db } = await import('../db')

const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const adm = async (m: string, p: string, b?: unknown) => {
  const r = await app.request('/api/admin' + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, j: (await r.json().catch(() => ({}))) as any }
}
const T = Date.now()
let orgId = 0

/**
 * Облачная точка, как её отдаёт Эвотор. Именно UPDATE, а не INSERT OR REPLACE:
 * REPLACE удаляет строку и обнулил бы `local_store_id` (привязку витрины).
 */
function cloudStore(uuid: string, name: string, address: string) {
  const exists = db.prepare('SELECT store_uuid FROM evotor_stores WHERE store_uuid=?').get(uuid)
  if (exists) {
    db.prepare('UPDATE evotor_stores SET name=?, address=?, updated_at=? WHERE store_uuid=?')
      .run(name, address, Date.now(), uuid)
    return
  }
  db.prepare(`INSERT INTO evotor_stores(store_uuid, name, address, updated_at, sync_enabled) VALUES(?,?,?,?,0)`)
    .run(uuid, name, address, Date.now())
}

beforeEach(async () => {
  if (!orgId) {
    const org = await adm('POST', '/organizations', {
      name: `ООО Витрина-${T}`,
      legalName: `ООО Витрина-${T}`,
      inn: '7701234567',
    })
    expect(org.s).toBe(200)
    orgId = Number(org.j.id)
  }
})

describe('витрина точки', () => {
  it('создаёт точку из облачной и связывает её', async () => {
    const uuid = `uuid-${T}-a`
    cloudStore(uuid, 'Точка 1', 'ул. Ленина, 1')
    const made = await adm('POST', `/evotor/stores/${uuid}/showcase`)
    expect(made.s).toBe(200)
    expect(made.j.created).toBe(true)
    const id = Number(made.j.storeId)

    const list = await adm('GET', '/stores')
    const row = (list.j.stores as any[]).find((s) => s.id === id)
    expect(row).toMatchObject({
      name: 'Точка 1',
      address: 'ул. Ленина, 1',
      evotorUuid: uuid,
      evotorName: 'Точка 1',
    })

    // Повторный вызов не плодит дубль.
    const again = await adm('POST', `/evotor/stores/${uuid}/showcase`)
    expect(again.j).toMatchObject({ storeId: id, created: false })
  })

  it('ручное название и адрес не перезаписываются облаком, снимок обновляется', async () => {
    const uuid = `uuid-${T}-b`
    cloudStore(uuid, 'Точка 2', 'ул. Мира, 2')
    const made = await adm('POST', `/evotor/stores/${uuid}/showcase`)
    const id = Number(made.j.storeId)

    const patch = await adm('PATCH', `/stores/${id}`, { name: '6.7 Coffee на Багратиона', address: 'ул. Багратиона, 7' })
    expect(patch.s).toBe(200)

    // Облако прислало новое название и адрес — витрина не должна измениться.
    cloudStore(uuid, 'Точка 2 (новая)', 'ул. Мира, 22')
    const { refreshEvotorSnapshot } = await import('../modules/admin/storeShowcase')
    refreshEvotorSnapshot(db as never, uuid)
    refreshEvotorSnapshot(db as never, uuid)

    const list = await adm('GET', '/stores')
    const row = (list.j.stores as any[]).find((s) => s.id === id)
    expect(row.name).toBe('6.7 Coffee на Багратиона')
    expect(row.address).toBe('ул. Багратиона, 7')
    expect(row.evotorName).toBe('Точка 2 (новая)')
    expect(row.evotorAddress).toBe('ул. Мира, 22')
  })

  it('хранит фото, ориентир и телефон и отдаёт их гостю', async () => {
    const uuid = `uuid-${T}-c`
    cloudStore(uuid, 'Точка 3', 'ул. Садовая, 3')
    const id = Number((await adm('POST', `/evotor/stores/${uuid}/showcase`)).j.storeId)

    const patch = await adm('PATCH', `/stores/${id}`, {
      photoUrl: '/uploads/point-480.webp',
      photoFullUrl: '/uploads/point-960.webp',
      entranceHint: 'Вход со двора, серая дверь',
      phone: '+7 999 123-45-67',
      lat: 55.7558,
      lng: 37.6173,
    })
    expect(patch.s).toBe(200)

    const dir = await app.request('/api/directory')
    const j = (await dir.json()) as any
    const store = (j.stores as any[]).find((s) => s.id === id)
    expect(store).toMatchObject({
      photoUrl: '/uploads/point-480.webp',
      photoFullUrl: '/uploads/point-960.webp',
      entranceHint: 'Вход со двора, серая дверь',
      phone: '+7 999 123-45-67',
      lat: 55.7558,
      lng: 37.6173,
    })

    const geo = await app.request('/api/directory/geo')
    const g = (await geo.json()) as any
    expect((g.stores as any[]).find((s) => s.id === id)).toMatchObject({ photoUrl: '/uploads/point-480.webp' })
  })

  it('одна витрина — одна облачная точка: повторная привязка переносит связь', async () => {
    const uuidA = `uuid-${T}-d`
    const uuidB = `uuid-${T}-e`
    cloudStore(uuidA, 'Точка A', 'ул. A, 1')
    cloudStore(uuidB, 'Точка B', 'ул. B, 2')
    const id = Number((await adm('POST', `/evotor/stores/${uuidA}/showcase`)).j.storeId)

    const link = await adm('POST', `/stores/${id}/link`, { storeUuid: uuidB })
    expect(link.s).toBe(200)

    const rows = db.prepare('SELECT store_uuid, local_store_id FROM evotor_stores WHERE store_uuid IN (?,?)')
      .all(uuidA, uuidB) as { store_uuid: string; local_store_id: number | null }[]
    const byUuid = Object.fromEntries(rows.map((r) => [r.store_uuid, r.local_store_id]))
    expect(byUuid[uuidB]).toBe(id)
    expect(byUuid[uuidA]).toBeNull()
  })

  it('отвязка снимает снимки, но точку не удаляет', async () => {
    const uuid = `uuid-${T}-f`
    cloudStore(uuid, 'Точка F', 'ул. F, 6')
    const id = Number((await adm('POST', `/evotor/stores/${uuid}/showcase`)).j.storeId)
    expect((await adm('DELETE', `/stores/${id}/link`)).s).toBe(200)

    const list = await adm('GET', '/stores')
    const row = (list.j.stores as any[]).find((s) => s.id === id)
    expect(row).toMatchObject({ evotorUuid: null, evotorName: null, address: 'ул. F, 6' })
  })

  it('точка создаётся без организации: юрлица приходят из Эвотора, справочник не обязателен', async () => {
    const created = await adm('POST', '/stores', { name: `Точка-без-юрлица-${T}`, address: 'ул. Без Юрлица, 1' })
    expect(created.s).toBe(200)
    const list = await adm('GET', '/stores')
    const row = (list.j.stores as any[]).find((s) => s.id === Number(created.j.id))
    expect(row.organizationId).toBeNull()
  })

  it('привязка к несуществующей облачной точке — 404', async () => {
    const id = Number((await adm('POST', '/stores', { name: `Точка-${T}`, address: 'ул. X, 1', organizationId: orgId })).j.id)
    const r = await adm('POST', `/stores/${id}/link`, { storeUuid: 'no-such-uuid' })
    expect(r.s).toBe(404)
  })
})
