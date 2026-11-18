/**
 * P0-04 — доверие к X-Forwarded-For только при `TRUST_PROXY_HEADERS=1`.
 *
 * Флаг включён: IP берётся из заголовка (за нашим прокси это правда).
 * Флаг выключен (см. `device-proxy-failclosed.test.ts`): заголовок игнорируется,
 * иначе любой клиент подделывал бы источник и обходил IP-лимиты.
 */
import { describe, expect, it } from 'vitest'

process.env.NODE_ENV = 'development'
process.env.TRUST_PROXY_HEADERS = '1'

const { config } = await import('../config')
const { clientIp, clientIpKey } = await import('../lib/clientIp')

const ctx = (headers: Record<string, string>) => ({
  req: { header: (name: string) => headers[name.toLowerCase()] },
})

describe('TRUST_PROXY_HEADERS=1', () => {
  it('IP берётся из X-Forwarded-For (первый адрес)', () => {
    expect(config.trustProxyHeaders).toBe(true)
    expect(clientIp(ctx({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
  })

  it('без XFF используется X-Real-IP', () => {
    expect(clientIp(ctx({ 'x-real-ip': '198.51.100.9' }))).toBe('198.51.100.9')
  })

  it('ключа лимита по IP нет, если заголовков нет', () => {
    expect(clientIpKey(ctx({}), 'guest')).toBeNull()
    expect(clientIpKey(ctx({ 'x-forwarded-for': '203.0.113.7' }), 'guest')).toBe('guest:203.0.113.7')
  })
})
