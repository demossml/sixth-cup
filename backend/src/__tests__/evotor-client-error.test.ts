import { afterEach, describe, expect, test, vi } from 'vitest'
import { EvotorApiError, EvotorClient } from '../integrations/evotor/client/EvotorClient'

afterEach(() => vi.unstubAllGlobals())

describe('Evotor API error diagnostics', () => {
  test('extras 403 error includes stage, method, path and empty-body marker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })))
    const client = new EvotorClient('test-token', 'https://api.evotor.ru', '')
    let caught: unknown
    try { await client.postProductExtras('store-1', []) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(EvotorApiError)
    expect(String(caught)).toContain('[extras] POST /api/v1/inventories/stores/store-1/products/extras')
    expect(String(caught)).toContain('status=403')
    expect(String(caught)).toContain('bodyEmpty=true')
    expect((caught as EvotorApiError).method).toBe('POST')
    expect((caught as EvotorApiError).stage).toBe('extras')
  })
})
