/**
 * P0-01 — fail-closed авторизация кассовых API.
 *
 * До фикса `evotorProxyStrict` при пустом `EVOTOR_PROXY_TOKEN` вызывал `next()`,
 * то есть «закрытый» контур кассы открывался сам, если переменную забыли задать.
 * Теперь без токена все кассовые ручки отвечают 503 `proxy_not_configured`,
 * а production вообще не стартует (проверка в `config.ts`).
 *
 * Файл намеренно НЕ задаёт `EVOTOR_PROXY_TOKEN`: config читает env при импорте,
 * поэтому состояние «токен не настроен» проверяется отдельным файлом.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-proxy-closed-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
delete process.env.EVOTOR_PROXY_TOKEN
delete process.env.EVOTOR_PROXY_ENFORCE

const { app } = await import('../app')
const { productionConfigIssues, CRITICAL_PROD_ENV } = await import('../config')
const { clientIp, clientIpKey } = await import('../lib/clientIp')

const JSONH = { 'content-type': 'application/json' }
const STORE = { 'X-Evotor-Store-Uuid': '8f1c1a52-1111-4c4c-9c9c-000000000001' }
const ANY_AUTH = { Authorization: 'Bearer whatever' }

async function expectClosed(res: Response, where: string) {
  expect(res.status, where).toBe(503)
  const body = (await res.json()) as { error?: string }
  expect(body.error, where).toBe('proxy_not_configured')
}

describe('без EVOTOR_PROXY_TOKEN кассовый контур закрыт', () => {
  it('resolve карты → 503', async () => {
    const res = await app.request('/api/devices/loyalty/resolve', {
      method: 'POST', headers: { ...JSONH, ...STORE }, body: JSON.stringify({ code: '1234' }),
    })
    await expectClosed(res, 'resolve')
  })

  it('активные заказы → 503 (даже с заголовком точки)', async () => {
    await expectClosed(await app.request('/api/devices/orders/active', { headers: STORE }), 'orders/active')
  })

  it('смена статуса заказа → 503', async () => {
    const res = await app.request('/api/devices/orders/any/status', {
      method: 'POST', headers: { ...JSONH, ...STORE }, body: JSON.stringify({ status: 'accepted' }),
    })
    await expectClosed(res, 'orders/:id/status')
  })

  it('регистрация клиента по телефону → 503', async () => {
    const res = await app.request('/api/devices/customers/register', {
      method: 'POST',
      headers: { ...JSONH, ...STORE },
      body: JSON.stringify({ phone: '+79001234567', pdConsent: true, pdConsentVersion: '2026-11' }),
    })
    await expectClosed(res, 'customers/register')
  })

  it('поиск клиента по телефону → 503', async () => {
    const res = await app.request('/api/devices/customers/lookup', {
      method: 'POST', headers: { ...JSONH, ...STORE }, body: JSON.stringify({ phone: '+79001234567' }),
    })
    await expectClosed(res, 'customers/lookup')
  })

  it('итоги смены → 503', async () => {
    await expectClosed(await app.request('/api/devices/shift/summary', { headers: STORE }), 'shift/summary')
  })

  it('логи кассы → 503', async () => {
    const res = await app.request('/api/devices/logs', {
      method: 'POST', headers: { ...JSONH, ...STORE }, body: JSON.stringify({ message: 'hello' }),
    })
    await expectClosed(res, 'logs')
  })

  it('pinger остаётся открытым — он только диагностика и ничего не меняет', async () => {
    const res = await app.request('/api/devices/ping', { headers: STORE })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; proxy: { authOk: boolean } }
    expect(body.ok).toBe(true)
    expect(body.proxy.authOk).toBe(false)
  })

  it('мусорный Authorization не помогает: контур всё равно закрыт', async () => {
    await expectClosed(await app.request('/api/devices/orders/active', { headers: { ...STORE, ...ANY_AUTH } }), 'orders/active junk auth')
  })
})

describe('production-конфиг: старт без критических переменных запрещён', () => {
  it('IP не берётся из X-Forwarded-For, пока TRUST_PROXY_HEADERS не включён', () => {
    // Флаг по умолчанию выключен: подделанный заголовок не должен становиться ключом лимита.
    const c = { req: { header: () => '203.0.113.7' } }
    expect(clientIp(c)).toBeNull()
    expect(clientIpKey(c, 'guest')).toBeNull()
  })

  it('пустое окружение → перечислены все критические переменные', () => {
    const issues = productionConfigIssues({})
    for (const name of CRITICAL_PROD_ENV) {
      expect(issues.some((i) => i.startsWith(name)), name).toBe(true)
    }
  })

  it('полный набор → проблем нет', () => {
    expect(productionConfigIssues({
      JWT_SECRET: 'a'.repeat(32),
      ADMIN_TOKEN: 'b'.repeat(24),
      EVOTOR_PROXY_TOKEN: 'c'.repeat(24),
      PUBLIC_BASE_URL: 'https://67coffee.ru',
      TRUST_PROXY_HEADERS: '1',
    })).toEqual([])
  })

  it('dev-значения секретов в production не принимаются', () => {
    const issues = productionConfigIssues({
      JWT_SECRET: 'dev-secret-change-me',
      ADMIN_TOKEN: 'dev-admin',
      EVOTOR_PROXY_TOKEN: 'c'.repeat(24),
      PUBLIC_BASE_URL: 'https://67coffee.ru',
      TRUST_PROXY_HEADERS: '1',
    })
    expect(issues.some((i) => i.includes('JWT_SECRET'))).toBe(true)
    expect(issues.some((i) => i.includes('ADMIN_TOKEN'))).toBe(true)
  })

  it('TRUST_PROXY_HEADERS принимает только 0/1, PUBLIC_BASE_URL — только URL', () => {
    const issues = productionConfigIssues({
      JWT_SECRET: 'a'.repeat(32),
      ADMIN_TOKEN: 'b'.repeat(24),
      EVOTOR_PROXY_TOKEN: 'c'.repeat(24),
      PUBLIC_BASE_URL: '67coffee.ru',
      TRUST_PROXY_HEADERS: 'yes',
    })
    expect(issues.some((i) => i.startsWith('TRUST_PROXY_HEADERS'))).toBe(true)
    expect(issues.some((i) => i.startsWith('PUBLIC_BASE_URL'))).toBe(true)
  })
})
