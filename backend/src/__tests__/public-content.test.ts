/**
 * L-16: `pushEnabled` в публичном контенте читает реальный флаг (`evotorConfig.pushEnabled`),
 * а не несуществующее поле config (из-за которого всегда было false).
 */
import { describe, expect, it } from 'vitest'
import { app } from '../app'
import { config, evotorConfig } from '../config'

const content = async () => {
  const r = await app.request('/api/public/content')
  expect(r.status).toBe(200)
  return (await r.json()) as { pushEnabled: boolean; legal_loyalty: string }
}

describe('L-16: /api/public/content', () => {
  it('pushEnabled совпадает с флагом сервера', async () => {
    const c = await content()
    expect(c.pushEnabled).toBe(evotorConfig.pushEnabled)
  })

  it('флаг берётся из evotorConfig, а не из config', async () => {
    expect((config as Record<string, unknown>).pushEnabled).toBeUndefined() // поля там нет
    expect(typeof evotorConfig.pushEnabled).toBe('boolean')
  })

  it('фолбэк правил зависит от cupsForFree', async () => {
    const c = await content()
    expect(c.legal_loyalty).toContain(String(config.cupsForFree))
    expect(c.legal_loyalty).not.toMatch(/шест/i)
  })
})
