import { beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { app } from '../app'
import { config } from '../config'
import { db } from '../db'
import { admin } from './wh-helpers'

function workbookFile(): File {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['КЛАССИКА'],
    ['Капучино QA'],
    ['300мл'],
    ['Ингредиенты'],
    ['1. Сироп Ваниль QA 10мл'],
  ]), 'Классика')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['ЗИМА'],
    ['Раф QA'],
    ['400мл'],
    ['Ингредиенты'],
    ['1. Молоко QA 250мл'],
  ]), 'Зимнее меню')
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new File([new Uint8Array(bytes)], 'techcards.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function makeProduct(name: string): number {
  const time = Date.now()
  return Number(db.prepare(
    `INSERT INTO products(name, price, available, created_at, updated_at) VALUES(?,?,1,?,?)`,
  ).run(name, 250, time, time).lastInsertRowid)
}

beforeEach(() => {
  db.prepare(`DELETE FROM tech_card_import_markers`).run()
  db.prepare(`DELETE FROM tech_card_lines`).run()
  db.prepare(`DELETE FROM tech_card_versions`).run()
  db.prepare(`DELETE FROM tech_cards`).run()
})

describe('techcard workbook preview and apply', () => {
  it('previews every sheet without writing and then saves an existing card as a new version', async () => {
    const stockItem = await admin('POST', '/stock/items', { name: 'Сироп Ваниль QA', kind: 'raw', unit: 'ml' })
    const stockItemId = Number(stockItem.json.item?.id ?? stockItem.json.id)
    const milk = await admin('POST', '/stock/items', { name: 'Молоко текущее QA', kind: 'raw', unit: 'ml' })
    const milkId = Number(milk.json.item?.id ?? milk.json.id)
    const productId = makeProduct('Капучино QA товар')
    const card = await admin('POST', '/cost/tech-cards', {
      name: 'Капучино QA 300 мл',
      kind: 'dish',
      productId,
      lines: [{ stockItemId: milkId, qtyBrutto: 200 }],
    })
    const cardId = card.json.card.id as number
    const originalVersionId = card.json.card.version.id as number

    const form = new FormData()
    form.set('file', workbookFile())
    const previewResponse = await app.request('/api/admin/cost/tech-cards/import/preview', {
      method: 'POST',
      headers: { 'X-Admin-Token': config.adminToken },
      body: form,
    })
    const preview = await previewResponse.json() as {
      recipes: {
        name: string
        sourceSheet: string
        cardMatches: { id: number; exact: boolean }[]
        lines: { ingredientName: string; qty: number; unit: string; matches: { id: number; exact: boolean }[] }[]
      }[]
      stockItems: { id: number }[]
    }

    expect(previewResponse.status).toBe(200)
    expect(preview.recipes.map((recipe) => recipe.sourceSheet)).toEqual(['Классика', 'Зимнее меню'])
    expect(preview.recipes[0]).toMatchObject({
      name: 'Капучино QA 300 мл',
      cardMatches: [{ id: cardId, exact: true }],
      lines: [{ ingredientName: 'Сироп Ваниль QA', qty: 10, unit: 'ml', matches: [{ id: stockItemId, exact: true }] }],
    })
    expect(preview.stockItems).toHaveLength(2)
    expect(db.prepare(`SELECT COUNT(*) AS count FROM tech_card_versions WHERE card_id=?`).get(cardId)).toMatchObject({ count: 1 })

    const confirm = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName: 'techcards.xlsx',
      recipes: [{
        name: 'Капучино QA 300 мл',
        sourceSheet: 'Классика',
        sourceRow: 3,
        targetCardId: cardId,
        newCardKind: null,
        productId,
        outputQty: null,
        outputUnit: null,
        methodText: null,
        lines: [{
          stockItemId,
          childCardId: null,
          name: 'Сироп Ваниль QA',
          unit: 'ml',
          qty: 10,
          lineRole: 'base',
        }],
      }],
    })
    expect(confirm.status).toBe(200)
    expect(confirm.json.cards).toEqual([{ id: cardId, name: 'Капучино QA 300 мл', changeKind: 'updated' }])

    const history = db.prepare(`SELECT id FROM tech_card_versions WHERE card_id=? ORDER BY valid_from, id`).all(cardId) as { id: number }[]
    expect(history).toHaveLength(2)
    expect(history[0]!.id).toBe(originalVersionId)
    const imported = await admin('GET', `/cost/tech-cards/${cardId}`)
    expect(imported.json.card.lines).toMatchObject([{ stockItemId, qtyBrutto: 10 }])
    expect(imported.json.card.importReviewCount).toBe(1)

    const ack = await admin('POST', `/cost/tech-cards/${cardId}/import-reviewed`, {})
    expect(ack.status).toBe(200)
    expect(ack.json.reviewed).toBe(1)
    const reviewed = await admin('GET', `/cost/tech-cards/${cardId}`)
    expect(reviewed.json.card.importReviewCount).toBe(0)
  })

  it('rejects uncertain or stale mappings atomically and leaves the existing recipe intact', async () => {
    const item = await admin('POST', '/stock/items', { name: 'Сироп Конфликт QA', kind: 'raw', unit: 'ml' })
    const itemId = Number(item.json.item?.id ?? item.json.id)
    const card = await admin('POST', '/cost/tech-cards', {
      name: 'Карта Конфликт QA',
      kind: 'semi',
      lines: [{ stockItemId: itemId, qtyBrutto: 5 }],
    })
    const cardId = card.json.card.id as number

    const result = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName: 'techcards.xlsx',
      recipes: [{
        name: 'Карта Конфликт QA',
        sourceSheet: 'Лист',
        sourceRow: 2,
        targetCardId: cardId,
        newCardKind: null,
        productId: null,
        outputQty: null,
        outputUnit: null,
        methodText: null,
        lines: [{
          stockItemId: itemId,
          childCardId: null,
          name: 'Сироп Конфликт QA',
          unit: 'g',
          qty: 20,
          lineRole: 'base',
        }],
      }],
    })
    expect(result.status).toBe(409)
    const unchanged = await admin('GET', `/cost/tech-cards/${cardId}`)
    expect(unchanged.json.card.lines).toMatchObject([{ stockItemId: itemId, qtyBrutto: 5 }])
    expect(unchanged.json.card.versions).toHaveLength(1)
    expect(unchanged.json.card.importReviewCount).toBe(0)
  })

  it('creates a new draft card and reuses a newly created ingredient within the batch', async () => {
    const result = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName: 'techcards.xlsx',
      recipes: [{
        name: 'Заготовка для теста QA',
        sourceSheet: 'Авторское',
        sourceRow: 4,
        targetCardId: null,
        newCardKind: 'semi',
        productId: null,
        outputQty: 100,
        outputUnit: 'g',
        methodText: null,
        lines: [
          { stockItemId: null, childCardId: null, name: 'Ингредиент новый QA', unit: 'g', qty: 5, lineRole: 'base' },
          { stockItemId: null, childCardId: null, name: 'Ингредиент новый QA', unit: 'g', qty: 10, lineRole: 'base' },
        ],
      }],
    })
    expect(result.status).toBe(200)
    const cardId = result.json.cards[0].id as number
    const card = await admin('GET', `/cost/tech-cards/${cardId}`)
    expect(card.json.card).toMatchObject({ name: 'Заготовка для теста QA', kind: 'semi', outputQty: 100, outputUnit: 'g', status: 'draft', importReviewCount: 1 })
    expect(card.json.card.lines).toHaveLength(2)
    expect(card.json.card.lines[0].stockItemId).toBe(card.json.card.lines[1].stockItemId)
    const ingredientCount = (db.prepare(
      `SELECT COUNT(*) AS count FROM stock_items WHERE name='Ингредиент новый QA' AND active=1`,
    ).get() as { count: number }).count
    expect(ingredientCount).toBe(1)
  })
})
