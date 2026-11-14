import { describe, expect, it } from 'vitest'
import { admin } from './wh-helpers'

/**
 * Аудит 14.11.2026: на складе было «Критично 7» при полном отсутствии приходов.
 * Экран должен получать признак «учёт не запущен» и объяснять нули.
 */
describe('GET /stock/balances — признак запущенного учёта', () => {
  it('без приходов accounting.started = false и есть счётчики', async () => {
    const r = await admin('GET', '/stock/balances')
    expect(r.status).toBe(200)
    expect(r.json.accounting).toBeTruthy()
    expect(r.json.accounting.postedInvoices).toBe(0)
    expect(r.json.accounting.started).toBe(false)
    expect(typeof r.json.accounting.suppliers).toBe('number')
  })
})
