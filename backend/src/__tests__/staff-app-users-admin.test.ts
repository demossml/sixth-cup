/**
 * STEP-3: админский CRUD пользователей приложения (/api/admin/app-users).
 * Доступ под существующим ADMIN_TOKEN; пароли в ответах не возвращаются.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-app-users-admin-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')

const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
const STORE = 'store-admin-1'

const post = (body: unknown) => app.request('/api/admin/app-users', { method: 'POST', headers: H, body: JSON.stringify(body) })
const patch = (id: number, body: unknown) => app.request(`/api/admin/app-users/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) })

type UserBody = { user: { id: number; login: string; role: string; storeUuid: string | null; active: boolean; alertBlink: boolean } }

beforeEach(() => {
  db.prepare('DELETE FROM app_users').run()
  db.prepare('DELETE FROM rate_limits').run()
})

describe('GET /api/admin/app-users', () => {
  it('без админского токена → 403', async () => {
    const res = await app.request('/api/admin/app-users')
    expect(res.status).toBe(403)
  })

  it('список пуст на чистой базе и не содержит хэшей', async () => {
    await post({ login: 'barista-list', password: 'secret123', role: 'barista', storeUuid: STORE })
    const res = await app.request('/api/admin/app-users', { headers: H })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('password_hash')
    const body = JSON.parse(text) as { users: { login: string; role: string; storeUuid: string }[]; roles: string[] }
    expect(body.users).toHaveLength(1)
    expect(body.users[0]).toMatchObject({ login: 'barista-list', role: 'barista', storeUuid: STORE })
    expect(body.roles).toEqual(['owner', 'admin', 'barista'])
  })
})

describe('POST /api/admin/app-users', () => {
  it('создаёт бариста с точкой', async () => {
    const res = await post({ login: 'b-create', password: 'secret123', role: 'barista', storeUuid: STORE })
    expect(res.status).toBe(201)
    const body = (await res.json()) as UserBody
    expect(body.user.storeUuid).toBe(STORE)
    expect(body.user.alertBlink).toBe(true)
  })

  it('бариста без точки → 400, короткий пароль → 400', async () => {
    expect((await post({ login: 'b-nostore', password: 'secret123', role: 'barista' })).status).toBe(400)
    expect((await post({ login: 'b-short', password: 'short', role: 'barista', storeUuid: STORE })).status).toBe(400)
  })

  it('повторный логин в другом регистре → 409', async () => {
    expect((await post({ login: 'dup-login', password: 'secret123', role: 'barista', storeUuid: STORE })).status).toBe(201)
    expect((await post({ login: 'DUP-LOGIN', password: 'secret123', role: 'barista', storeUuid: STORE })).status).toBe(409)
  })
})

describe('PATCH /api/admin/app-users/:id', () => {
  it('сброс пароля и отключение доступа', async () => {
    const created = (await (await post({ login: 'b-patch', password: 'secret123', role: 'barista', storeUuid: STORE })).json()) as UserBody
    const id = created.user.id

    const p1 = await patch(id, { password: 'secret456', active: false })
    expect(p1.status).toBe(200)
    const after = (await p1.json()) as UserBody
    expect(after.user.active).toBe(false)

    const login = (password: string) =>
      app.request('/api/staff/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login: 'b-patch', password }),
      })
    expect((await login('secret123')).status).toBe(401)
    // Пароль верный, но доступ закрыт — 403, чтобы UI написал «обратитесь к администратору».
    expect((await login('secret456')).status).toBe(403)

    expect((await patch(id, { active: true })).status).toBe(200)
    expect((await login('secret456')).status).toBe(200)
  })

  it('точка обязательна при смене роли на бариста', async () => {
    const created = (await (await post({ login: 'owner-x', password: 'secret123', role: 'owner' })).json()) as UserBody
    expect((await patch(created.user.id, { role: 'barista' })).status).toBe(400)
    expect((await patch(created.user.id, { role: 'barista', storeUuid: STORE })).status).toBe(200)
  })

  it('смена роли бариста → owner очищает точку', async () => {
    const created = (await (await post({ login: 'b-to-owner', password: 'secret123', role: 'barista', storeUuid: STORE })).json()) as UserBody
    const res = await patch(created.user.id, { role: 'owner' })
    expect(res.status).toBe(200)
    const after = (await res.json()) as UserBody
    expect(after.user.role).toBe('owner')
    expect(after.user.storeUuid).toBeNull()
  })

  it('несуществующий id → 404, пустой патч → 400', async () => {
    expect((await patch(99999, { active: false })).status).toBe(404)
    const created = (await (await post({ login: 'patch-empty', password: 'secret123', role: 'owner' })).json()) as UserBody
    expect((await patch(created.user.id, {})).status).toBe(400)
  })
})
