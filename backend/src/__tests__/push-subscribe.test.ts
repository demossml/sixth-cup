/**
 * Push «заказ готов»: подписка гостя, отписка, отметка «отправлено один раз».
 * Реальная отправка не выполняется — проверяем контракт и запись в БД.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-push-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
// Ключи фиктивные: web-push примет их для подписи, отправка на фейковый endpoint просто упадёт.
process.env.VAPID_PUBLIC_KEY = 'B'.repeat(87)
process.env.VAPID_PRIVATE_KEY = 'K'.repeat(43)
process.env.VAPID_SUBJECT = 'mailto:test@example.com'

const { app } = await import('../app')
const { db } = await import('../db')
const { notifyOrderStatus, pushConfigured } = await import('../modules/push/service')

const JSONH = { 'content-type': 'application/json' }

async function guestToken(): Promise<string> {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: JSONH, body: '{}' })
  return ((await r.json()) as { token: string }).token
}

const sub = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: 'B' + 'p'.repeat(80), auth: 'a' + 'u'.repeat(20) },
  userAgent: 'vitest',
})

beforeEach(() => {
  db.prepare('DELETE FROM push_subscriptions').run()
})

describe('подписка', () => {
  it('ключи настроены — публичный ключ отдаётся без авторизации', async () => {
    expect(pushConfigured()).toBe(true)
    const r = await app.request('/api/push/public-key')
    expect(r.status).toBe(200)
    const j = (await r.json()) as { ok: boolean; publicKey: string }
    expect(j.ok).toBe(true)
    expect(j.publicKey).toHaveLength(87)
  })

  it('подписка сохраняется и идемпотентна', async () => {
    const token = await guestToken()
    const endpoint = 'https://push.example.com/abc'
    const first = await app.request('/api/push/subscribe', {
      method: 'POST', headers: { ...JSONH, Authorization: `Bearer ${token}` }, body: JSON.stringify(sub(endpoint)),
    })
    expect(first.status).toBe(200)
    const second = await app.request('/api/push/subscribe', {
      method: 'POST',
      headers: { ...JSONH, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...sub(endpoint), keys: { p256dh: 'C' + 'q'.repeat(80), auth: 'b' + 'v'.repeat(20) } }),
    })
    expect(second.status).toBe(200)
    const rows = db.prepare('SELECT endpoint, p256dh, revoked_at FROM push_subscriptions').all() as Array<{
      endpoint: string; p256dh: string; revoked_at: number | null
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0].p256dh.startsWith('C')).toBe(true)
    expect(rows[0].revoked_at).toBeNull()
  })

  it('битая подписка — 400, без авторизации — 401', async () => {
    const token = await guestToken()
    const bad = await app.request('/api/push/subscribe', {
      method: 'POST', headers: { ...JSONH, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: 'not-a-url', keys: { p256dh: 'x', auth: 'y' } }),
    })
    expect(bad.status).toBe(400)
    const noAuth = await app.request('/api/push/subscribe', { method: 'POST', headers: JSONH, body: JSON.stringify(sub('https://p.example/e')) })
    expect(noAuth.status).toBe(401)
  })

  it('отписка помечает подписку revoked', async () => {
    const token = await guestToken()
    const endpoint = 'https://push.example.com/bye'
    await app.request('/api/push/subscribe', {
      method: 'POST', headers: { ...JSONH, Authorization: `Bearer ${token}` }, body: JSON.stringify(sub(endpoint)),
    })
    const r = await app.request('/api/push/subscribe', {
      method: 'DELETE', headers: { ...JSONH, Authorization: `Bearer ${token}` }, body: JSON.stringify({ endpoint }),
    })
    expect(r.status).toBe(200)
    const row = db.prepare('SELECT revoked_at FROM push_subscriptions WHERE endpoint=?').get(endpoint) as { revoked_at: number | null }
    expect(row.revoked_at).toBeTruthy()
  })
})

describe('отметка «отправлено один раз»', () => {
  it('ready ставит push_ready_at только при первом вызове', async () => {
    const t = Date.now()
    db.prepare('INSERT INTO stores(id,name,address) VALUES(?,?,?)').run(1, 'Точка', 'ул. 1')
    db.prepare(
      `INSERT INTO preorders(id, short_code, store_id, status, estimate_total, currency, expires_at, created_at, updated_at, guest_user_id)
       VALUES('o-1','111111',1,'ready',100,'RUB',?,?,?,?)`,
    ).run(t + 60_000, t, t, 5)

    notifyOrderStatus(db as never, { id: 'o-1', status: 'ready', shortCode: '111111', guestUserId: 5 } as never)
    const first = db.prepare('SELECT push_ready_at FROM preorders WHERE id=?').get('o-1') as { push_ready_at: number | null }
    expect(first.push_ready_at).toBeTruthy()

    notifyOrderStatus(db as never, { id: 'o-1', status: 'ready', shortCode: '111111', guestUserId: 5 } as never)
    const second = db.prepare('SELECT push_ready_at, push_paid_at FROM preorders WHERE id=?').get('o-1') as {
      push_ready_at: number | null; push_paid_at: number | null
    }
    expect(second.push_ready_at).toBe(first.push_ready_at)
    expect(second.push_paid_at).toBeNull()
  })
})
