/**
 * P0-04 — обратная сторона fail-fast: с полным набором переменных production стартует.
 * Если этот тест начнёт падать, значит проверка конфигурации стала слишком строгой
 * и положит реальный деплой.
 */
import { describe, expect, it } from 'vitest'

process.env.NODE_ENV = 'production'
process.env.JWT_SECRET = 'prod-jwt-secret-0123456789abcdef0123456789'
process.env.ADMIN_TOKEN = 'prod-admin-token-0123456789'
process.env.EVOTOR_PROXY_TOKEN = 'prod-proxy-token-0123456789'
process.env.PUBLIC_BASE_URL = 'https://67coffee.ru'
process.env.TRUST_PROXY_HEADERS = '1'

describe('production с полным конфигом', () => {
  it('config загружается без ошибок', async () => {
    const mod = await import('../config')
    expect(mod.config.isDev).toBe(false)
    expect(mod.productionConfigIssues(process.env)).toEqual([])
  })
})
