import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-auditfix-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'own'
process.env.ADMIN_MARKETER_TOKEN = 'mgr'
process.env.ADMIN_VIEWER_TOKEN = 'view'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { MANAGER_BLOCKED } = await import('../modules/admin/routes')
const { looksLikeVideo } = await import('../modules/upload/routes')
const { errorText } = await import('../../../frontend-admin/src/api/client')
const { fmtKopFixed } = await import('../../../frontend-admin/src/lib/format')

const call = (tok: string, method: string, p: string, body?: unknown) =>
  app.request('/api/admin' + p, { method, headers: { 'X-Admin-Token': tok, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const json = async (r: Response) => (await r.json()) as any

describe('admin client helpers', () => {
  it('errorText never returns an object', () => {
    expect(errorText({ error: 'Forbidden' }, 'x')).toBe('Forbidden')
    expect(errorText({ success: false, error: { issues: [{ path: ['price'], message: 'Expected integer, received float' }] } }, 'x'))
      .toBe('Проверьте данные — price: Expected integer, received float')
    expect(errorText({}, 'fallback')).toBe('fallback')
    expect(errorText(null, 'fallback')).toBe('fallback')
  })
  it('fmtKopFixed always has two decimals', () => {
    expect(fmtKopFixed(3086400)).toBe('30 864,00')
    expect(fmtKopFixed(2962944)).toBe('29 629,44')
    expect(fmtKopFixed(-5)).toBe('-0,05')
    expect(fmtKopFixed(null)).toBe('0,00')
  })
})

describe('manager role boundaries', () => {
  it('blocks stores/devices/AI settings/mass vouchers but not evotor store sync or products', () => {
    for (const p of [
      '/api/admin/stores', '/api/admin/stores/3', '/api/admin/devices/1/revoke',
      '/api/admin/ai/settings', '/api/admin/vouchers/grant-all', '/api/admin/reset',
      '/stores', '/devices', '/devices/1/revoke', '/ai/settings', '/vouchers/grant-all', '/reset',
      // шаблоны ваучеров — та же зона, что массовая выдача
      '/api/admin/voucher-templates', '/api/admin/voucher-templates/3',
      '/voucher-templates', '/voucher-templates/3',
    ])
      expect(MANAGER_BLOCKED.test(p), p).toBe(true)
    for (const p of [
      '/api/admin/products', '/api/admin/evotor/stores/abc/push-products',
      '/api/admin/promos/1/publish', '/api/admin/ai/content-draft',
      '/products', '/evotor/stores/abc/push-products',
    ])
      expect(MANAGER_BLOCKED.test(p), p).toBe(false)
  })
  it('manager gets 403 on a till enrolment, owner is fine', async () => {
    const org = await json(await call('own', 'POST', '/organizations', { name: 'o', legalName: 'o', inn: '1234567890' }))
    const store = await json(await call('own', 'POST', '/stores', { name: 's', address: 'a', organizationId: org.id }))
    expect((await call('mgr', 'POST', '/devices', { storeId: store.id, name: 'k' })).status).toBe(403)
    expect((await call('mgr', 'POST', '/stores', { name: 's2', address: 'a', organizationId: org.id })).status).toBe(403)
    expect((await call('mgr', 'PUT', '/ai/settings', { enabled: true })).status).toBe(403)
    const d = await json(await call('own', 'POST', '/devices', { storeId: store.id, name: 'k' }))
    expect(d.enrollCode).toBeTruthy()
    const asOwner = await json(await call('own', 'GET', '/devices'))
    const asMgr = await json(await call('mgr', 'GET', '/devices'))
    expect(asOwner.devices[0].enrollCode).toBeTruthy()
    expect(asMgr.devices[0].enrollCode).toBeNull()
  })
  it('manager can still edit content', async () => {
    const r = await call('mgr', 'POST', '/products', { name: 'Тест', price: 100 })
    expect(r.status).toBe(200)
  })
})

describe('phone access', () => {
  it('viewer cannot read it; owner can and it is audited with the role', async () => {
    db.prepare("INSERT INTO users(phone, nickname, invite_code, created_at) VALUES('+79990001122','t','INVX',?)").run(Date.now())
    const uid = (db.prepare("SELECT id FROM users WHERE invite_code='INVX'").get() as any).id
    expect((await call('view', 'GET', `/customers/${uid}/phone`)).status).toBe(403)
    const before = (db.prepare('SELECT COUNT(*) n FROM admin_audit').get() as any).n
    const r = await call('mgr', 'GET', `/customers/${uid}/phone`)
    expect(r.status).toBe(200)
    expect((await json(r)).phone).toBe('+79990001122')
    const after = (db.prepare('SELECT COUNT(*) n FROM admin_audit').get() as any).n
    expect(after).toBe(before + 1)
    const row = db.prepare('SELECT actor, method, entity, entity_id AS id FROM admin_audit ORDER BY id DESC LIMIT 1').get() as any
    expect(row).toMatchObject({ actor: 'manager', method: 'GET', entity: 'customers', id: String(uid) })
  })
  it('audit actor records the role of mutating calls', async () => {
    await call('mgr', 'POST', '/categories', { name: 'Роль' })
    const row = db.prepare("SELECT actor FROM admin_audit WHERE path LIKE '%/categories' ORDER BY id DESC LIMIT 1").get() as any
    expect(row.actor).toBe('manager')
  })
})

describe('data safety', () => {
  it('grant-all with an unknown template is 404, not 500', async () => {
    expect((await call('own', 'POST', '/vouchers/grant-all', { code: 'no-such-code' })).status).toBe(404)
  })
  it('product edit with a stale expectedUpdatedAt is a 409, a fresh one passes', async () => {
    const created = await json(await call('own', 'POST', '/products', { name: 'Лок', price: 100 }))
    const p = db.prepare('SELECT updated_at AS u FROM products WHERE id=?').get(created.id) as any
    expect((await call('own', 'POST', '/products', { id: created.id, name: 'Лок', price: 150, expectedUpdatedAt: p.u - 5 })).status).toBe(409)
    expect((await call('own', 'POST', '/products', { id: created.id, name: 'Лок', price: 150, expectedUpdatedAt: p.u })).status).toBe(200)
    expect((await call('own', 'POST', '/products', { id: created.id, name: 'Лок', price: 160 })).status).toBe(200) // old clients: no lock
  })
  it('unknown scheme / device give 404', async () => {
    expect((await call('own', 'POST', '/modifier-schemes', { id: 99999, name: 'x' })).status).toBe(404)
    expect((await call('own', 'DELETE', '/devices/99999')).status).toBe(404)
    expect((await call('own', 'POST', '/devices/99999/revoke')).status).toBe(404)
  })
  it('scheme update keeps its items in one transaction and does not create orphans', async () => {
    const m = db.prepare("INSERT INTO modifiers(name,price,group_key,available,sort_order,created_at,updated_at) VALUES('m',10,'other',1,0,1,1)").run()
    const s = await json(await call('own', 'POST', '/modifier-schemes', { name: 'S', modifierIds: [Number(m.lastInsertRowid)] }))
    // R1: канон — modifier_scheme_options; легаси items больше не пишется.
    const n = () => (db.prepare("SELECT COUNT(*) n FROM modifier_scheme_options WHERE scheme_id=? AND kind='modifier'").get(s.id) as any).n
    const legacy = () => (db.prepare('SELECT COUNT(*) n FROM modifier_scheme_items WHERE scheme_id=?').get(s.id) as any).n
    expect(n()).toBe(1)
    expect(legacy()).toBe(0)
    await call('own', 'POST', '/modifier-schemes', { id: s.id, name: 'S2', modifierIds: [Number(m.lastInsertRowid)] })
    expect(n()).toBe(1)
    expect(legacy()).toBe(0)
  })
})

describe('upload', () => {
  const up = (tok: string, bytes: number[], type: string, name: string) => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(bytes)], name, { type }))
    return app.request('/api/admin/upload', { method: 'POST', headers: { 'X-Admin-Token': tok }, body: fd })
  }
  const mp4 = [0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]
  it('signature check', () => {
    expect(looksLikeVideo(Buffer.from(mp4), 'video/mp4')).toBe(true)
    expect(looksLikeVideo(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), 'video/mp4')).toBe(false)
    expect(looksLikeVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]), 'video/webm')).toBe(true)
  })
  it('manager may upload a real mp4, viewer may not, a fake mp4 is refused', async () => {
    expect((await up('mgr', mp4, 'video/mp4', 'a.mp4')).status).toBe(200)
    expect((await up('view', mp4, 'video/mp4', 'a.mp4')).status).toBe(403)
    expect((await up('own', [1, 2, 3], 'video/mp4', 'a.mp4')).status).toBe(400)
    expect((await up('own', [1, 2, 3], 'text/html', 'a.html')).status).toBe(400)
  })
})
