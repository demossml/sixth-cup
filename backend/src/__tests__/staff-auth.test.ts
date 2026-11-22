/**
 * STEP-1/2: пользователи приложения (login/password) и вход сотрудника.
 *
 * Проверяем то, что реально ломает контур: уникальность логина без учёта регистра,
 * отказ неактивному, отзыв токенов при сбросе пароля и изоляцию staff-токена от гостевого.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-staff-auth-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { createAppUser, updateAppUser, findAppUserByLogin } = await import('../modules/staff/appUsers')

const JSONH = { 'content-type': 'application/json' }
const STORE = 'store-barista-1'

async function login(login: string, password: string) {
  return app.request('/api/staff/login', {
    method: 'POST',
    headers: JSONH,
    body: JSON.stringify({ login, password }),
  })
}

async function mkBarista(login: string, password = 'secret123') {
  return createAppUser({ login, password, role: 'barista', storeUuid: STORE })
}

beforeEach(() => {
  db.prepare('DELETE FROM app_users').run()
  db.prepare('DELETE FROM rate_limits').run()
})

describe('app_users: миграция и уникальность', () => {
  it('логин уникален без учёта регистра', async () => {
    await createAppUser({ login: 'Owner', password: 'secret123', role: 'owner' })
    await expect(createAppUser({ login: 'owner', password: 'secret123', role: 'owner' }))
      .rejects.toMatchObject({ status: 409 })
    expect(findAppUserByLogin('OWNER')?.role).toBe('owner')
  })

  it('barista без точки и пароль короче 8 символов отклоняются', async () => {
    await expect(createAppUser({ login: 'b1', password: 'secret123', role: 'barista' }))
      .rejects.toMatchObject({ status: 400 })
    await expect(createAppUser({ login: 'b1', password: 'short', role: 'barista', storeUuid: STORE }))
      .rejects.toMatchObject({ status: 400 })
  })
})

describe('POST /api/staff/login', () => {
  it('верный пароль → токен и профиль', async () => {
    await mkBarista('barista-ok')
    const res = await login('barista-ok', 'secret123')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; role: string; storeUuid: string; alertBlink: boolean }
    expect(body.token.split('.')).toHaveLength(3)
    expect(body.role).toBe('barista')
    expect(body.storeUuid).toBe(STORE)
    expect(body.alertBlink).toBe(true)
  })

  it('логин в другом регистре принимается', async () => {
    await mkBarista('barista-case')
    const res = await login('BARISTA-CASE', 'secret123')
    expect(res.status).toBe(200)
  })

  it('неверный пароль → 401, несуществующий логин → 401', async () => {
    await mkBarista('barista-wrong')
    expect((await login('barista-wrong', 'nope-wrong')).status).toBe(401)
    expect((await login('no-such-user', 'secret123')).status).toBe(401)
  })

  it('отключённый сотрудник → 403', async () => {
    const u = await mkBarista('barista-off')
    updateAppUser(u.id, { active: false })
    const res = await login('barista-off', 'secret123')
    expect(res.status).toBe(403)
  })
})

describe('GET /api/staff/me', () => {
  it('без токена → 401', async () => {
    expect((await app.request('/api/staff/me')).status).toBe(401)
  })

  it('с токеном → профиль', async () => {
    await mkBarista('barista-me')
    const { token } = (await (await login('barista-me', 'secret123')).json()) as { token: string }
    const res = await app.request('/api/staff/me', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { login: string; role: string } }
    expect(body.user.login).toBe('barista-me')
    expect(body.user.role).toBe('barista')
  })

  it('гостевой токен не открывает staff-роуты', async () => {
    const g = await app.request('/api/auth/guest', { method: 'POST', headers: JSONH, body: '{}' })
    const { token } = (await g.json()) as { token: string }
    const res = await app.request('/api/staff/me', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
  })

  it('staff-токен не принимается как гостевой', async () => {
    await mkBarista('barista-notguest')
    const { token } = (await (await login('barista-notguest', 'secret123')).json()) as { token: string }
    const res = await app.request('/api/auth/revoke', {
      method: 'POST',
      headers: { ...JSONH, Authorization: `Bearer ${token}` },
      body: '{}',
    })
    expect(res.status).toBe(401)
  })

  it('сброс пароля отзывает ранее выданный токен', async () => {
    const u = await mkBarista('barista-reset')
    const { token } = (await (await login('barista-reset', 'secret123')).json()) as { token: string }
    await updateAppUser(u.id, { password: 'secret456' })
    expect((await app.request('/api/staff/me', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
    expect((await login('barista-reset', 'secret456')).status).toBe(200)
  })
})
