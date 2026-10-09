import { describe, expect, test } from 'vitest'
import { outboxRetryDelay, toEvotorProduct } from '../integrations/evotor/sync/ProductPushService'

describe('Evotor product sync', () => {
  test('outbox retry delay is capped exponential backoff', () => {
    expect([1, 2, 3, 4, 5, 6].map(outboxRetryDelay)).toEqual([60_000, 120_000, 300_000, 900_000, 3_600_000, 3_600_000])
  })

  test('does not invent an Evotor product UUID and keeps RUB price units', () => {
    const payload = toEvotorProduct({
      id: 42,
      name: 'Капучино 300',
      price: 220,
      available: 1,
      counts_as_cup: 1,
      evotor_uuid: null,
      tax: 'NO_VAT',
      measure: 'шт',
      cost_price_kopecks: 5310,
      free_eligible: 1,
      season_start_at: null,
      season_end_at: null,
      evotor_extra_json: null,
      modifier_scheme_id: null,
      recipe_text: '18g + 180ml',
      recipe_cost_rub: 53,
      recipe_seconds: 90,
      catalog_source: 'SIXTH_CUP',
    }, 'store-1')

    expect(payload).not.toHaveProperty('uuid')
    expect(payload.price).toBe(220)
    expect(payload.cost_price).toBe(53.1)
    expect(payload.measure_name).toBe('шт')
    expect(payload.allow_to_sell).toBe(true)
    expect(payload.article_number).toBe('sc-42')
    expect(payload.costPrice).toBeUndefined()
    expect(payload.articleNumber).toBeUndefined()
  })
})
