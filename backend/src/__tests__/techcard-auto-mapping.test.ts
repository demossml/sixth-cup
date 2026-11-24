import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../db'
import { autoMapTechcardWorkbook, type AutoMatchRecipeInput } from '../modules/admin/techcardAutoMapping'

function input(): AutoMatchRecipeInput[] {
  return [{
    key: 'Лист:3:1',
    name: 'Капучино 300 мл',
    cards: [
      { id: 10, name: 'Капучино 300 мл', score: 1 },
      { id: 11, name: 'Капучино 400 мл', score: 0.67 },
    ],
    products: [
      { id: 20, name: 'Капучино', score: 0.6 },
      { id: 21, name: 'Латте', score: 0.2 },
    ],
    lines: [
      {
        recipeKey: 'Лист:3:1',
        lineIndex: 0,
        name: 'Молоко 3,2%',
        unit: 'ml',
        isEspresso: false,
        stockItems: [{ id: 30, name: 'Молоко 3,2%', score: 1 }],
        childCards: [],
      },
      {
        recipeKey: 'Лист:3:1',
        lineIndex: 1,
        name: 'Сливки',
        unit: 'ml',
        isEspresso: false,
        stockItems: [],
        childCards: [],
      },
    ],
  }]
}

function setAi(enabled: boolean, apiKey: string) {
  const upsert = db.prepare(
    `INSERT INTO app_settings(key, value, updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  )
  upsert.run('ai_enabled', enabled ? '1' : '0', Date.now())
  upsert.run('ai_api_key', apiKey, Date.now())
}

beforeEach(() => setAi(false, ''))
afterEach(() => {
  setAi(false, '')
  vi.unstubAllGlobals()
})

describe('autoMapTechcardWorkbook', () => {
  it('matches by names and leaves missing entities for automatic creation', async () => {
    const result = await autoMapTechcardWorkbook(input())

    expect(result.provider).toBe('heuristic')
    expect(result.warning).toBeNull()
    expect(result.recipes[0]).toMatchObject({ key: 'Лист:3:1', card: { id: 10, confidence: 'high' } })
    expect(result.recipes[0]!.product.id).toBe(20)
    expect(result.lines[0]).toMatchObject({ lineIndex: 0, stockItem: { id: 30, confidence: 'high' } })
    expect(result.lines[1]).toMatchObject({ lineIndex: 1, stockItem: { id: null }, childCard: { id: null } })
  })

  it('uses model ids only when they exist and falls back for unknown ids', async () => {
    setAi(true, 'test-key')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            recipes: [{
              key: 'Лист:3:1',
              card: { id: 11, confidence: 'medium', reason: 'Похожее название' },
              product: { id: 999, confidence: 'high', reason: 'выдуманный id' },
            }],
            lines: [
              { recipeKey: 'Лист:3:1', lineIndex: 0, stockItem: { id: 30, confidence: 'high' } },
              { recipeKey: 'Лист:3:1', lineIndex: 1, stockItem: { id: null, confidence: 'low', reason: 'нет на складе' } },
            ],
          }),
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const result = await autoMapTechcardWorkbook(input())

    expect(result.provider).toBe('deepseek')
    expect(result.recipes[0]!.card).toMatchObject({ id: 11, confidence: 'medium' })
    expect(result.recipes[0]!.product.id).toBe(20)
    expect(result.lines[1]!.stockItem).toMatchObject({ id: null, confidence: 'low' })
  })

  it('falls back to name matching with a warning when the provider fails', async () => {
    setAi(true, 'test-key')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })))

    const result = await autoMapTechcardWorkbook(input())

    expect(result.provider).toBe('heuristic')
    expect(result.warning).toContain('HTTP 503')
    expect(result.recipes[0]!.card.id).toBe(10)
  })
})
