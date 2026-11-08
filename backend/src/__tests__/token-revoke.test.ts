/**
 * P1-6: JWT отзывается.
 *
 * Токен гостя живёт 180 дней. Раньше потерянный телефон сохранял доступ навсегда:
 * версия токена в БД позволяет отозвать все ранее выданные токены (сброс карты, восстановление, /revoke).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sign } from 'hono/jwt'

const dir = mkdtempSync(join(tmpdir(), 'sc-token-revoke-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const { config } = await import('../config')
const { app } = await import('../app')

async function mkGuest(): Promise<{ userId: number; token: string }> {
  const res = await app.request('/api/auth/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  const body = (await res.json()) as { token: string }
  const payload = JSON.parse(Buffer.from(body.token.split('.')[1] as string, 'base64url').toString('utf8')) as { sub: number }
  return { userId: Number(payload.sub), token: body.token }
}

const me = (token: string) => app.request('/api/loyalty/card', { headers: { Authorization: 'Bearer ' + token } })

describe('token_version / revoke', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM rate_limits').run()
  })

  it('свежий токен принимается', async () => {
    const g = await mkGuest()
    expect((await me(g.token)).status).toBe(200)
  })

  it('/revoke делает прежний токен недействительным, новый выпущенный — рабочий', async () => {
    const g = await mkGuest()
    const revoke = await app.request('/api/auth/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + g.token } })
    expect(revoke.status).toBe(200)
    expect((await me(g.token)).status).toBe(401)

    const again = await app.request('/api/auth/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const fresh = (await again.json()) as { token: string }
    expect((await me(fresh.token)).status).toBe(200)
  })

  it('токен без ver (легаси) не проходит после отзыва', async () => {
    const g = await mkGuest()
    const legacy = await sign({ sub: g.userId, exp: Math.floor(Date.now() / 1000) + 600 }, config.jwtSecret)
    expect((await me(legacy)).status).toBe(200)
    await app.request('/api/auth/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + g.token } })
    expect((await me(legacy)).status).toBe(401)
  })

  it('восстановление по коду отзывает токены прежнего устройства', async () => {
    const g = await mkGuest()
    const rec = await app.request('/api/auth/recovery', { method: 'POST', headers: { Authorization: 'Bearer ' + g.token } })
    const { recovery } = (await rec.json()) as { recovery: string }

    const restored = await app.request('/api/auth/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recovery }) })
    expect(restored.status).toBe(200)
    const { token } = (await restored.json()) as { token: string }

    expect((await me(g.token)).status).toBe(401)
    expect((await me(token)).status).toBe(200)
  })
})
