import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-tok-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
delete process.env.EVOTOR_API_TOKEN

const { db } = await import('../db')
const {
  createToken,
  resolveToken,
  anyTokenConfigured,
  listActivePlainTokens,
  clientForStore,
  ensureTokenSchema,
} = await import('../integrations/evotor/tokenStore')

describe('Evotor tokenStore (admin-managed, no env)', () => {
  beforeAll(() => {
    ensureTokenSchema(db)
  })

  it('without tokens anyTokenConfigured is false and resolve returns null', () => {
    expect(anyTokenConfigured(db)).toBe(false)
    expect(resolveToken(db, 'any-store')).toBeNull()
  })

  it('createToken stores encrypted secret and resolveToken returns plain for bound store', () => {
    const row = createToken(db, {
      label: 'cabinet-1',
      token: 'test-secret-token-abcdef',
      storeUuids: ['store-aaa', 'store-bbb'],
    })
    expect(row.tokenHint.length).toBeGreaterThan(0)
    expect(row.active).toBe(true)
    expect(anyTokenConfigured(db)).toBe(true)
    expect(listActivePlainTokens(db)).toContain('test-secret-token-abcdef')
    expect(resolveToken(db, 'store-aaa')).toBe('test-secret-token-abcdef')
    expect(resolveToken(db, 'store-bbb')).toBe('test-secret-token-abcdef')
    expect(resolveToken(db, 'store-unknown')).toBeNull()
    const client = clientForStore(db, 'store-aaa')
    expect(client.isConfigured).toBe(true)
  })

  it('admin POST /evotor/tokens works without EVOTOR_API_TOKEN', async () => {
    const { app } = await import('../app')
    const res = await app.request('/api/admin/evotor/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': 'test-admin',
      },
      body: JSON.stringify({ label: 'from-api', token: 'another-valid-token-xyz', storeUuids: [] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { token: { id: number; label: string } }
    expect(body.token.label).toBe('from-api')
  })

  it('GET /evotor/stores fails with clear error only when no tokens at all', async () => {
    db.exec('DELETE FROM evotor_token_stores; DELETE FROM evotor_api_tokens')
    expect(anyTokenConfigured(db)).toBe(false)
    const { app } = await import('../app')
    const res = await app.request('/api/admin/evotor/stores', {
      headers: { 'X-Admin-Token': 'test-admin' },
    })
    expect([502, 503]).toContain(res.status)
    const text = await res.text()
    expect(text).toMatch(/EVOTOR_API_TOKEN not set/)
  })
})
