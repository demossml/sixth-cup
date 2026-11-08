/**
 * WAVE 3: технический долг и abuse-лимиты.
 *
 * P2-1 схема предзаказов не создаётся заново на каждый запрос,
 * P2-2 индексы предзаказов существуют,
 * P2-3 ограниченный параллелизм опроса точек (mapLimit),
 * P2-4 метрики доставки push,
 * P2-6 CORS whitelist,
 * P2-8/P2-9 лимиты на чувствительные вызовы.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-wave3-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const { ensurePreorderTables } = await import('../modules/orders/service')
const { mapLimit } = await import('../lib/concurrency')
const { allowRequest } = await import('../lib/rateLimit')
const { pushMetrics } = await import('../modules/push/service')
const { app } = await import('../app')

const indexNames = (table: string) =>
  (db.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[]).map((r) => r.name)

describe('P2-1: схема предзаказов создаётся один раз', () => {
  it('повторный вызов не выполняет DDL', () => {
    ensurePreorderTables(db as never)
    let ddl = 0
    const originalExec = db.exec.bind(db)
    // Считаем только DDL: повторный вызов должен выйти до exec.
    db.exec = ((sql: string) => { ddl++; return originalExec(sql) }) as typeof db.exec
    try {
      ensurePreorderTables(db as never)
      ensurePreorderTables(db as never)
    } finally {
      db.exec = originalExec as typeof db.exec
    }
    expect(ddl).toBe(0)
  })
})

describe('P2-2: индексы предзаказов', () => {
  it('миграция создала индексы для горячих выборок', () => {
    ensurePreorderTables(db as never)
    const idx = indexNames('preorders')
    expect(idx).toContain('idx_preorders_guest_status')
    expect(idx).toContain('idx_preorders_status_expires')
    expect(indexNames('preorder_items')).toContain('idx_preorder_items_order')
    expect(indexNames('preorder_item_modifiers')).toContain('idx_preorder_item_modifiers_item')
  })
})

describe('P2-3: ограниченный параллелизм', () => {
  it('обрабатывает все элементы, но не больше limit одновременно', async () => {
    let active = 0
    let peak = 0
    const seen: number[] = []
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      seen.push(n)
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14])
    expect(seen).toHaveLength(7)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('пустой список и limit=0 не ломаются', async () => {
    expect(await mapLimit([], 4, async (n: number) => n)).toEqual([])
    expect(await mapLimit([1, 2], 0, async (n) => n + 1)).toEqual([2, 3])
  })
})

describe('P2-6: CORS whitelist', () => {
  it('чужой origin не получает разрешающих заголовков', async () => {
    const res = await app.request('/api/directory/config/1', { headers: { Origin: 'https://evil.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('localhost (dev) и same-origin разрешены', async () => {
    const res = await app.request('/api/directory/config/1', { headers: { Origin: 'http://localhost:5173' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  })
})

describe('P2-4: метрики push', () => {
  it('считает живые и падающие подписки', () => {
    const now = Date.now()
    db.prepare('INSERT INTO push_subscriptions(endpoint,p256dh,auth,user_id,failures,created_at,updated_at,revoked_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('https://push.example/1', 'k', 'a', 1, 5, now, now, null)
    db.prepare('INSERT INTO push_subscriptions(endpoint,p256dh,auth,user_id,failures,created_at,updated_at,revoked_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('https://push.example/2', 'k', 'a', 1, 0, now, now, now)
    const m = pushMetrics()
    expect(m.subscriptions).toBeGreaterThanOrEqual(2)
    expect(m.failing).toBeGreaterThanOrEqual(1)
    expect(m.revoked).toBeGreaterThanOrEqual(1)
    expect(m.live).toBe(m.subscriptions - m.revoked)
  })
})

describe('P2-8/P2-9: лимиты запросов', () => {
  it('allowRequest держит окно и отдаёт false после исчерпания', () => {
    const t = 1_700_000_000_000
    expect(allowRequest('k-1', 2, 1000, t)).toBe(true)
    expect(allowRequest('k-1', 2, 1000, t + 10)).toBe(true)
    expect(allowRequest('k-1', 2, 1000, t + 20)).toBe(false)
    expect(allowRequest('k-1', 2, 1000, t + 2000)).toBe(true)
  })

  it('quote ограничен по пользователю', async () => {
    const guest = await app.request('/api/auth/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const { token } = (await guest.json()) as { token: string }
    const payload = JSON.parse(Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8')) as { sub: number }
    // Окно уже исчерпано прошлыми вызовами — следующий обязан получить 429.
    for (let i = 0; i < 120; i++) allowRequest(`quote:${payload.sub}`, 120, 60_000)
    const res = await app.request('/api/orders/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ storeId: 1, items: [] }),
    })
    expect(res.status).toBe(429)
  })
})
