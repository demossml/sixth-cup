import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-customer-auth-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.JWT_SECRET = 'test-jwt-secret'

const { app } = await import('../app')
const { seedIfEmpty } = await import('../db/seed')
const { db } = await import('../db')

seedIfEmpty()

async function json(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await app.request(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

describe('automatic customer account', () => {
  it('creates a customer without phone/SMS and gives a card', async () => {
    const r = await json('POST', '/api/auth/guest', {})
    expect(r.status).toBe(200)
    expect(r.data.token).toBeTruthy()
    expect(r.data.userId).toBeGreaterThan(0)

    const card = db.prepare('SELECT user_id FROM cards WHERE user_id=?').get(r.data.userId)
    expect(card).toBeTruthy()
  })

  it('stores inviter relationship when created with invite code', async () => {
    const inviter = await json('POST', '/api/auth/guest', {})
    const row = db.prepare('SELECT invite_code FROM users WHERE id=?').get(inviter.data.userId) as { invite_code: string }
    const invited = await json('POST', '/api/auth/guest', { inviteCode: row.invite_code })
    const user = db.prepare('SELECT invited_by FROM users WHERE id=?').get(invited.data.userId) as { invited_by: number }
    expect(user.invited_by).toBe(inviter.data.userId)
  })
})

describe('customer recovery QR', () => {
  it('creates a one-time recovery token and restores the same account', async () => {
    const created = await json('POST', '/api/auth/guest', {})
    const recovery = await json('POST', '/api/auth/recovery/create', {}, created.data.token)
    expect(recovery.status).toBe(200)
    expect(recovery.data.token).toBeTruthy()

    const restored = await json('POST', '/api/auth/recovery/use', { token: recovery.data.token })
    expect(restored.status).toBe(200)
    expect(restored.data.userId).toBe(created.data.userId)

    const reused = await json('POST', '/api/auth/recovery/use', { token: recovery.data.token })
    expect(reused.status).toBe(401)
  })
})

afterAll(() => {
  try { db.close() } catch { /* test cleanup */ }
  rmSync(dir, { recursive: true, force: true })
})
