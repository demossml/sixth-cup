import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-logs-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin-token-123'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret-456'
process.env.LOG_PATH = join(dir, 'logs', 'api.log')

const { app } = await import('../app')
const { db } = await import('../db')
const { _clearLogBuffer, maskCode, redact, writeLog } = await import('../lib/logBuffer')
const { _resetLogRateLimits } = await import('../modules/logs/routes')

const admin = { 'X-Admin-Token': 'test-admin-token-123' }
const proxy = { 'Content-Type': 'application/json', Authorization: 'proxy-secret-456', 'X-Evotor-Store-Uuid': 'abcd-store', 'X-Evotor-Device-UUID': 'efgh-dev' }

async function getLogs(qs = '') {
  const r = await app.request(`/api/admin/logs${qs}`, { headers: admin })
  return { status: r.status, data: (await r.json()) as { lines: string[]; available: number; generatedAt: number } }
}
const post = (path: string, body: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }) =>
  app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })

beforeEach(() => {
  _clearLogBuffer()
  _resetLogRateLimits()
})

describe('GET /api/admin/logs', () => {
  it('requires the admin token', async () => {
    const r = await app.request('/api/admin/logs')
    expect(r.status).toBe(403)
  })

  it('is empty at first, Тест writes one line', async () => {
    expect((await getLogs()).data.lines).toEqual([])
    const t = await app.request('/api/admin/logs/test', { method: 'POST', headers: admin })
    expect(t.status).toBe(200)
    const { data } = await getLogs('?lines=50&source=server')
    const mine = data.lines.filter((l) => l.includes('admin log test'))
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z \[server\] \[info\] admin log test/)
    expect(data.available).toBe(2) // the test line + the HTTP line of POST /logs/test
    expect(data.generatedAt).toBeGreaterThan(0)
  })

  it('does not log its own polling, but logs other /api requests with status and duration', async () => {
    await getLogs()
    await getLogs()
    await app.request('/api/directory/nonexistent-xyz')
    const { data } = await getLogs()
    expect(data.lines.filter((l) => l.includes('/api/admin/logs'))).toHaveLength(0)
    expect(data.lines.some((l) => /\[server\] \[warn\] GET \/api\/directory\/nonexistent-xyz 404 \d+ms/.test(l))).toBe(true)
  })

  it('records 4xx with a short error message', async () => {
    await app.request('/api/admin/overview', { headers: { 'X-Admin-Token': 'wrong' } })
    const { data } = await getLogs()
    expect(data.lines.some((l) => /\[warn\] GET \/api\/admin\/overview 403 \d+ms error="Forbidden"/.test(l))).toBe(true)
  })

  it('limits lines, takes the newest, and filters by source and level', async () => {
    for (let i = 0; i < 30; i++) writeLog('server', 'info', `s${i}`)
    writeLog('client', 'error', 'c-err')
    writeLog('device', 'warn', 'd-warn')
    expect((await getLogs('?lines=20')).data.lines).toHaveLength(20)
    expect((await getLogs('?lines=20')).data.lines.at(-1)).toContain('d-warn')
    expect((await getLogs('?source=client')).data.lines).toHaveLength(1)
    expect((await getLogs('?source=device')).data.lines[0]).toContain('[device] [warn] d-warn')
    expect((await getLogs('?source=kassa')).data.lines).toHaveLength(1)
    expect((await getLogs('?level=error')).data.lines).toHaveLength(1)
    const all = await getLogs('?lines=500&source=all&level=all')
    expect(all.data.available).toBe(32)
    expect((await getLogs('?source=nope')).status).toBe(400)
    expect((await getLogs('?level=nope')).status).toBe(400)
  })

  it('a flood of client logs cannot evict server lines', async () => {
    writeLog('server', 'info', 'keep-me')
    for (let i = 0; i < 5000; i++) writeLog('client', 'info', `c${i}`)
    expect((await getLogs('?source=server')).data.lines).toHaveLength(1)
  })

  it('mirrors lines to LOG_PATH', async () => {
    writeLog('server', 'info', 'file-mirror-check')
    expect(readFileSync(process.env.LOG_PATH!, 'utf8')).toContain('[server] [info] file-mirror-check')
  })
})

describe('secrets never reach the buffer', () => {
  it('redact() strips tokens, bearer headers, JWTs, QR tokens and env secrets', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijklmnop'
    const qr = 'eyJpZCI6IkNBUkQxMjM0NTY3ODkwMTIzNDU2Nzg5MCJ9.MEUCIQDabcdefghijklmnopqrstuvwxyz0123456789ABCD'
    const out = redact(
      `Authorization: Bearer abc.def.ghi-123456 jwt=${jwt} qr=${qr} admin test-admin-token-123 proxy-secret-456 token=zzzzzz1234 id=11111111-2222-3333-4444-555555555555`,
    )
    for (const bad of ['abc.def.ghi', jwt, qr, 'test-admin-token-123', 'proxy-secret-456', 'zzzzzz1234']) {
      expect(out).not.toContain(bad)
    }
    expect(out).toContain('11111111-2222-3333-4444-555555555555') // plain uuids stay readable
  })

  it('HTTP lines never contain headers, query strings or request bodies', async () => {
    await app.request('/api/directory/x?token=querysecret1234&password=hunter22', {
      headers: { Authorization: 'Bearer jwt-secret-value-9999', 'X-Admin-Token': 'test-admin-token-123', Cookie: 'sid=cookiesecret' },
    })
    await post('/api/auth/guest', { password: 'bodysecret-xyz' })
    const text = (await getLogs('?lines=500')).data.lines.join('\n')
    for (const bad of ['querysecret', 'hunter22', 'jwt-secret-value', 'test-admin-token-123', 'cookiesecret', 'bodysecret']) {
      expect(text).not.toContain(bad)
    }
    expect(text).toContain('/api/directory/x')
  })

  it('maskCode keeps only the last two digits and never echoes a token', () => {
    expect(maskCode('0042')).toBe('••42')
    expect(maskCode('7')).toBe('••7')
    expect(maskCode('aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb')).toBe('[token]')
    expect(maskCode('')).toBe('••')
    expect(maskCode(maskCode('0042'))).toBe('••42')
  })
})

describe('POST /api/client-logs', () => {
  it('accepts a client event without auth and tags it [client]', async () => {
    const r = await post('/api/client-logs', { level: 'error', message: 'TypeError: x is undefined', meta: { page: '/card' }, source: 'device' })
    expect(r.status).toBe(200)
    const { data } = await getLogs('?source=client')
    expect(data.lines).toHaveLength(1)
    expect(data.lines[0]).toMatch(/\[client\] \[error\] TypeError: x is undefined page=\/card/)
    expect((await getLogs('?source=device')).data.lines).toHaveLength(0) // source spoofing ignored
  })

  it('accepts batches, truncates messages, flattens newlines and redacts secrets', async () => {
    const r = await post('/api/client-logs', {
      entries: [
        { level: 'info', message: 'a'.repeat(1500).replace(/a{50}/g, 'ab ') },
        { level: 'warn', message: 'line1\n2099-01-01T00:00:00Z [server] [error] forged\rline3 Bearer abcdefghijklmnop' },
        { level: 'info', message: 'q', meta: { token: 'x', cardCode: '123456', jwt: 'eyJabcde.abcdefgh.abcdefg' } },
      ],
    })
    expect(r.status).toBe(200)
    const lines = (await getLogs('?source=client')).data.lines
    expect(lines).toHaveLength(3)
    expect(lines[0].length).toBeLessThan(600)
    expect(lines[1].includes('\n') || lines[1].includes('\r')).toBe(false)
    expect(lines[1]).not.toContain('abcdefghijklmnop')
    expect(lines[2]).toContain('token=[redacted]')
    expect(lines[2]).toContain('cardCode=••56')
    expect(lines[2]).not.toContain('123456')
    // forged text is inside one client line, so it cannot masquerade as a server line
    expect((await getLogs('?source=server')).data.lines.some((l) => l.includes('forged'))).toBe(false)
  })

  it('validates input, limits size and rate-limits per IP', async () => {
    expect((await post('/api/client-logs', { level: 'bogus', message: 'x' })).status).toBe(400)
    expect((await post('/api/client-logs', { message: '' })).status).toBe(400)
    const big = await app.request('/api/client-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(20_000) },
      body: JSON.stringify({ message: 'x'.repeat(20_000) }),
    })
    expect(big.status).toBe(413)
    const h = { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' }
    const codes: number[] = []
    for (let i = 0; i < 35; i++) codes.push((await post('/api/client-logs', { message: `m${i}` }, h)).status)
    expect(codes.filter((c) => c === 200)).toHaveLength(30)
    expect(codes.at(-1)).toBe(429)
    // another IP is unaffected
    expect((await post('/api/client-logs', { message: 'ok' }, { ...h, 'x-forwarded-for': '203.0.113.10' })).status).toBe(200)
  })
})

describe('POST /api/devices/logs (till)', () => {
  it('requires the proxy token', async () => {
    const r = await post('/api/devices/logs', { message: 'scan' }, { 'Content-Type': 'application/json' })
    expect(r.status).toBe(403)
    const r2 = await post('/api/devices/logs', { message: 'scan' }, { 'Content-Type': 'application/json', Authorization: 'wrong' })
    expect(r2.status).toBe(403)
    expect((await getLogs('?source=device')).data.lines).toHaveLength(0)
  })

  it('stores till events as [device] with store/device tag and masked card code', async () => {
    const qr = 'eyJpZCI6IkNBUkQxMjM0NTY3ODkwMTIzNDU2Nzg5MCJ9.MEUCIQDabcdefghijklmnopqrstuvwxyz0123456789ABCD'
    const r = await post(
      '/api/devices/logs',
      {
        entries: [
          { level: 'info', message: 'scan QR', meta: { code: qr, kind: 'token' } },
          { level: 'warn', message: 'resolve fail', meta: { code: '0042', error: 'card_not_found' } },
          { level: 'info', message: `discount applied card ${qr}`, meta: { freeCups: 1 } },
        ],
      },
      proxy,
    )
    expect(r.status).toBe(200)
    const lines = (await getLogs('?source=device&lines=50')).data.lines
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('[device] [info] (abcd/efgh) scan QR code=[token]')
    expect(lines[1]).toContain('code=••42 error=card_not_found')
    const text = lines.join('\n')
    expect(text).not.toContain('MEUCIQD')
    expect(text).not.toContain('proxy-secret-456')
  })
})

describe('loyalty resolve events', () => {
  it('logs resolve ok / fail with a masked card code and no QR token', async () => {
    const g = await app.request('/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const { token } = (await g.json()) as { token: string }
    const c = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
    const card = (await c.json()) as { card: string; cardCode: string }
    db.prepare('UPDATE users SET card_code=? WHERE card_code=?').run('48151623', card.cardCode)
    card.cardCode = '48151623'
    _clearLogBuffer()

    const ok = await post('/api/devices/loyalty/resolve', { code: card.card }, proxy)
    expect(ok.status).toBe(200)
    const miss = await post('/api/devices/loyalty/resolve', { code: '99999999' }, proxy)
    expect(miss.status).toBe(404)

    const text = (await getLogs('?source=server&lines=100')).data.lines.join('\n')
    expect(text).toMatch(/\[info\] loyalty resolve ok card=••23 kind=token/)
    expect(text).toMatch(/\[warn\] loyalty resolve fail: card_not_found card=••99/)
    expect(text).not.toContain(card.card)
    expect(text).not.toContain(card.cardCode)
    expect(text).not.toContain('proxy-secret-456')
  })
})
