/**
 * P0-01 — с настроенным `EVOTOR_PROXY_TOKEN` кассовый контур работает как раньше,
 * но только с валидным credential.
 *
 * Проверяем два инварианта:
 *  1) рабочий поток кассы (валидный `Authorization`) не сломан;
 *  2) `X-Evotor-Store-Uuid` сам по себе больше не является пропуском.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-proxy-auth-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')

const JSONH = { 'content-type': 'application/json' }
const STORE_UUID = '8f1c1a52-1111-4c4c-9c9c-000000000001'
const STORE = { 'X-Evotor-Store-Uuid': STORE_UUID }
const PROXY = { Authorization: 'Bearer proxy-secret' }
const WRONG = { Authorization: 'Bearer not-the-secret' }

async function mkStore(name: string): Promise<number> {
  db.prepare(`INSERT INTO stores(name, address, open_time, close_time) VALUES(?,?,?,?)`)
    .run(name, 'адрес', '08:00', '22:00')
  const row = db.prepare('SELECT id FROM stores WHERE name=?').get(name) as { id: number }
  return Number(row.id)
}

function linkEvotor(storeId: number, storeUuid: string) {
  db.prepare('INSERT OR REPLACE INTO evotor_stores(store_uuid, name, address, local_store_id) VALUES(?,?,?,?)')
    .run(storeUuid, 'Кофейня', 'адрес', storeId)
}

describe('с валидным прокси-токеном касса работает', () => {
  it('itogi smeny → 200', async () => {
    const res = await app.request('/api/devices/shift/summary', { headers: { ...STORE, ...PROXY } })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true)
  })

  it('resolve проходит авторизацию и отвечает бизнес-ошибкой, а не 403/503', async () => {
    const res = await app.request('/api/devices/loyalty/resolve', {
      method: 'POST', headers: { ...JSONH, ...STORE, ...PROXY }, body: JSON.stringify({ code: '0000000000' }),
    })
    expect([404, 400]).toContain(res.status)
  })

  it('активные заказы → 200', async () => {
    const storeId = await mkStore('Точка A')
    linkEvotor(storeId, STORE_UUID)
    const res = await app.request('/api/devices/orders/active', { headers: { ...STORE, ...PROXY } })
    expect(res.status).toBe(200)
  })
})

describe('без валидного credential доступа нет', () => {
  it('смена итогов: неверный токен → 403', async () => {
    const res = await app.request('/api/devices/shift/summary', { headers: { ...STORE, ...WRONG } })
    expect(res.status).toBe(403)
  })

  it('смена итогов: без заголовка → 403', async () => {
    const res = await app.request('/api/devices/shift/summary', { headers: STORE })
    expect(res.status).toBe(403)
  })

  it('только X-Evotor-Store-Uuid заказы не открывает → 401', async () => {
    const storeId = await mkStore('Точка B')
    linkEvotor(storeId, STORE_UUID)
    const res = await app.request('/api/devices/orders/active', { headers: STORE })
    expect(res.status).toBe(401)
  })

  it('неверный токен на заказах → 401', async () => {
    const res = await app.request('/api/devices/orders/active', { headers: { ...STORE, ...WRONG } })
    expect(res.status).toBe(401)
  })

  it('смена статуса без credential → 401 и ничего не меняет', async () => {
    const storeId = await mkStore('Точка C')
    linkEvotor(storeId, STORE_UUID)
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`INSERT INTO preorders(id, short_code, store_id, status, estimate_total, currency, expires_at, created_at, updated_at)
      VALUES('o-guard','444444',?,'draft',300,'RUB',?,?,?)`).run(storeId, now + 1800, now, now)
    const res = await app.request('/api/devices/orders/o-guard/status', {
      method: 'POST', headers: { ...JSONH, ...STORE }, body: JSON.stringify({ status: 'accepted' }),
    })
    expect(res.status).toBe(401)
    const row = db.prepare('SELECT status FROM preorders WHERE id=?').get('o-guard') as { status: string }
    expect(row.status).toBe('draft')
  })

  it('регистрация клиента без credential → 403 и пользователь не создаётся', async () => {
    const before = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    const res = await app.request('/api/devices/customers/register', {
      method: 'POST',
      headers: { ...JSONH, ...STORE },
      body: JSON.stringify({ phone: '+79005550001', pdConsent: true, pdConsentVersion: '2026-11' }),
    })
    expect(res.status).toBe(403)
    const after = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    expect(after).toBe(before)
  })
})
