/**
 * P0-04 — fail fast: в production пустой конфиг не даёт приложению стартовать.
 *
 * Проверяем именно рантайм-поведение `config.ts`, а не только чистую функцию:
 * модуль обязан бросить ошибку со списком отсутствующих переменных.
 */
import { describe, expect, it } from 'vitest'

process.env.NODE_ENV = 'production'
delete process.env.JWT_SECRET
delete process.env.ADMIN_TOKEN
delete process.env.EVOTOR_PROXY_TOKEN
delete process.env.PUBLIC_BASE_URL
delete process.env.TRUST_PROXY_HEADERS

describe('production без критических переменных', () => {
  it('импорт config падает и перечисляет, чего не хватает', async () => {
    await expect(import('../config')).rejects.toThrow(/Production config incomplete/)
    await expect(import('../config')).rejects.toThrow(/JWT_SECRET/)
    await expect(import('../config')).rejects.toThrow(/EVOTOR_PROXY_TOKEN/)
  })
})
