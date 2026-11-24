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

function espressoWorkbookFile(): File {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['КОФЕ'],
    ['Americano QA'],
    ['200мл'],
    ['Ингредиенты'],
    ['1. 2 шота эспрессо'],
  ]), 'Кофе')
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new File([new Uint8Array(bytes)], 'espresso-techcards.xlsx', {
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
  it('saves a priced stock item independently and rejects duplicate names and units', async () => {
    const name = `Новая позиция QA ${Date.now()}`
    const saved = await admin('POST', '/cost/items', {
      name,
      unit: 'g',
      packageQty: 1000,
      packagePriceRub: 120,
    })

    expect(saved.status).toBe(201)
    const id = saved.json.id as number
    expect(db.prepare(
      `SELECT name, unit, package_qty AS packageQty, package_price_kop AS packagePriceKop,
              manual_cost_kop AS manualCostKop, price_mode AS priceMode
         FROM stock_items WHERE id=?`,
    ).get(id)).toMatchObject({
      name,
      unit: 'g',
      packageQty: 1000,
      packagePriceKop: 12000,
      manualCostKop: null,
      priceMode: 'manual',
    })
    expect(db.prepare(
      `SELECT cost_kop AS costKop, source FROM stock_item_cost_history WHERE stock_item_id=?`,
    ).get(id)).toMatchObject({ costKop: 12, source: 'manual' })

    const espresso = await admin('POST', '/cost/items', {
      name: 'Espresso',
      unit: 'pcs',
      packageQty: 2,
      packagePriceRub: 0,
    })
    expect(espresso.status).toBe(400)

    const duplicate = await admin('POST', '/cost/items', {
      name: `${name}!!!`,
      unit: 'g',
      packageQty: 500,
      packagePriceRub: 80,
    })
    expect(duplicate.status).toBe(409)
    expect(db.prepare(`SELECT COUNT(*) AS count FROM stock_items WHERE unit='g' AND name=?`).get(name))
      .toMatchObject({ count: 1 })
    db.prepare(`DELETE FROM stock_item_cost_history WHERE stock_item_id=?`).run(id)
    db.prepare(`DELETE FROM stock_items WHERE id=?`).run(id)
  })

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
      lines: [{ stockItemId: milkId, qtyBrutto: 200, lossColdPct: 5, lossHotPct: 2 }],
    })
    const cardId = card.json.card.id as number
    const originalVersionId = card.json.card.version.id as number
    const existingLineId = card.json.card.lines[0].id as number

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
        cardMatches: {
          id: number
          exact: boolean
          currentVersionId: number | null
          currentLines: { lineId: number; lossColdPct: number; lossHotPct: number }[]
        }[]
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
    expect(preview.recipes[0]!.cardMatches[0]).toMatchObject({
      currentVersionId: originalVersionId,
      currentLines: [{ lineId: existingLineId, lossColdPct: 5, lossHotPct: 2 }],
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
        expectedVersionId: originalVersionId,
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
    expect(imported.json.card.lines).toMatchObject([
      { stockItemId, qtyBrutto: 10 },
      { stockItemId: milkId, qtyBrutto: 200, lossColdPct: 5, lossHotPct: 2 },
    ])
    expect(imported.json.card.importReviewCount).toBe(1)

    const ack = await admin('POST', `/cost/tech-cards/${cardId}/import-reviewed`, {})
    expect(ack.status).toBe(200)
    expect(ack.json.reviewed).toBe(1)
    const reviewed = await admin('GET', `/cost/tech-cards/${cardId}`)
    expect(reviewed.json.card.importReviewCount).toBe(0)
  })

  it('links imported espresso shots to the existing Espresso card and recalculates consumers when it changes', async () => {
    const beans = await admin('POST', '/stock/items', {
      name: 'Кофейные зёрна Espresso QA',
      kind: 'raw',
      unit: 'g',
    })
    const beansId = Number(beans.json.item?.id ?? beans.json.id)
    await admin('PUT', `/cost/items/${beansId}`, { manualCostRub: 0.1 })

    const espressoProductId = makeProduct('Espresso QA Product')
    const espresso = await admin('POST', '/cost/tech-cards', {
      name: 'Espresso',
      kind: 'dish',
      productId: espressoProductId,
      outputQty: 1,
      outputUnit: 'pcs',
      lines: [{ stockItemId: beansId, qtyBrutto: 18 }],
    })
    const espressoId = espresso.json.card.id as number

    const form = new FormData()
    form.set('file', espressoWorkbookFile())
    const previewResponse = await app.request('/api/admin/cost/tech-cards/import/preview', {
      method: 'POST',
      headers: { 'X-Admin-Token': config.adminToken },
      body: form,
    })
    const preview = await previewResponse.json() as {
      recipes: {
        lines: {
          ingredientName: string
          qty: number
          unit: string
          semiMatches: { id: number; name: string; exact: boolean }[]
        }[]
      }[]
      cards: { id: number; name: string; canBeChild: boolean }[]
    }

    expect(previewResponse.status).toBe(200)
    expect(preview.recipes[0]!.lines[0]).toMatchObject({
      ingredientName: 'Espresso',
      qty: 2,
      unit: 'pcs',
      semiMatches: [{ id: espressoId, name: 'Espresso', exact: true }],
    })
    expect(preview.cards.find((card) => card.id === espressoId)).toMatchObject({ canBeChild: true })

    const americanoProductId = makeProduct('Americano QA Product')
    const stockMapping = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName: 'espresso-techcards.xlsx',
      recipes: [{
        name: 'Americano QA 200 мл',
        sourceSheet: 'Кофе',
        sourceRow: 3,
        targetCardId: null,
        expectedVersionId: null,
        newCardKind: 'dish',
        productId: americanoProductId,
        outputQty: 1,
        outputUnit: 'pcs',
        methodText: null,
        lines: [{
          stockItemId: beansId,
          childCardId: null,
          name: 'Эспрессо (двойной)',
          unit: 'pcs',
          qty: 2,
          lineRole: 'base',
        }],
      }],
    })
    expect(stockMapping.status).toBe(400)

    const confirm = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName: 'espresso-techcards.xlsx',
      recipes: [{
        name: 'Americano QA 200 мл',
        sourceSheet: 'Кофе',
        sourceRow: 3,
        targetCardId: null,
        expectedVersionId: null,
        newCardKind: 'dish',
        productId: americanoProductId,
        outputQty: 1,
        outputUnit: 'pcs',
        methodText: null,
        lines: [{
          stockItemId: null,
          childCardId: espressoId,
          name: 'Espresso',
          unit: 'pcs',
          qty: 2,
          lineRole: 'base',
        }],
      }],
    })
    expect(confirm.status).toBe(200)
    const americanoId = confirm.json.cards[0].id as number

    const before = await admin('GET', `/cost/tech-cards/${americanoId}`)
    expect(before.json.card.lines).toMatchObject([{ childCardId: espressoId, stockItemId: null, qtyBrutto: 2 }])
    expect(before.json.card.costPerUnitRub).toBe(3.6)

    const newEspressoVersion = await admin('POST', `/cost/tech-cards/${espressoId}/versions`, {
      validFrom: (espresso.json.card.version.validFrom as number) + 1,
      note: 'updated espresso dose',
    })
    const changedEspresso = await admin('PUT', `/cost/tech-cards/${espressoId}?versionId=${newEspressoVersion.json.versionId}`, {
      lines: [{ stockItemId: beansId, qtyBrutto: 20 }],
    })
    expect(changedEspresso.status).toBe(200)
    const after = await admin('GET', `/cost/tech-cards/${americanoId}`)
    expect(after.json.card.costPerUnitRub).toBe(4)
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
    const expectedVersionId = card.json.card.version.id as number

    const result = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName: 'techcards.xlsx',
      recipes: [{
        name: 'Карта Конфликт QA',
        sourceSheet: 'Лист',
        sourceRow: 2,
        targetCardId: cardId,
        expectedVersionId,
        newCardKind: null,
        productId: null,
        outputQty: null,
        outputUnit: null,
        methodText: null,
        existingLines: [{ action: 'keep', lineId: 999999 }],
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
    const staleVersion = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName: 'techcards.xlsx',
      recipes: [{
        name: 'Карта Конфликт QA',
        sourceSheet: 'Лист',
        sourceRow: 2,
        targetCardId: cardId,
        expectedVersionId: expectedVersionId + 1,
        newCardKind: null,
        productId: null,
        outputQty: null,
        outputUnit: null,
        methodText: null,
        lines: [{
          stockItemId: itemId,
          childCardId: null,
          name: 'Сироп Конфликт QA',
          unit: 'ml',
          qty: 20,
          lineRole: 'base',
        }],
      }],
    })
    expect(staleVersion.status).toBe(409)
    const unchanged = await admin('GET', `/cost/tech-cards/${cardId}`)
    expect(unchanged.json.card.lines).toMatchObject([{ stockItemId: itemId, qtyBrutto: 5 }])
    expect(unchanged.json.card.versions).toHaveLength(1)
    expect(unchanged.json.card.importReviewCount).toBe(0)
  })

  it('lets the reviewer keep, edit, and explicitly delete unmatched current lines', async () => {
    const cup = await admin('POST', '/stock/items', { name: 'Стаканчик QA', kind: 'raw', unit: 'pcs' })
    const cupId = Number(cup.json.item?.id ?? cup.json.id)
    const straw = await admin('POST', '/stock/items', { name: 'Трубочка QA', kind: 'raw', unit: 'pcs' })
    const strawId = Number(straw.json.item?.id ?? straw.json.id)
    const lid = await admin('POST', '/stock/items', { name: 'Крышка QA', kind: 'raw', unit: 'pcs' })
    const lidId = Number(lid.json.item?.id ?? lid.json.id)
    const replacement = await admin('POST', '/stock/items', { name: 'Трубочка широкая QA', kind: 'raw', unit: 'pcs' })
    const replacementId = Number(replacement.json.item?.id ?? replacement.json.id)
    const syrup = await admin('POST', '/stock/items', { name: 'Сироп для импорта QA', kind: 'raw', unit: 'ml' })
    const syrupId = Number(syrup.json.item?.id ?? syrup.json.id)
    const productId = makeProduct('Капучино для изменения QA')
    const card = await admin('POST', '/cost/tech-cards', {
      name: 'Капучино QA 300 мл',
      kind: 'dish',
      productId,
      lines: [
        { stockItemId: cupId, qtyBrutto: 1 },
        { stockItemId: strawId, qtyBrutto: 1 },
        { stockItemId: lidId, qtyBrutto: 1 },
      ],
    })
    const cardId = card.json.card.id as number
    const currentLines = card.json.card.lines as { id: number; stockItemId: number }[]

    const result = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName: 'techcards.xlsx',
      recipes: [{
        name: 'Капучино QA 300 мл',
        sourceSheet: 'Классика',
        sourceRow: 3,
        targetCardId: cardId,
        expectedVersionId: card.json.card.version.id as number,
        newCardKind: null,
        productId,
        outputQty: null,
        outputUnit: null,
        methodText: null,
        existingLines: [
          { action: 'keep', lineId: currentLines.find((line) => line.stockItemId === cupId)!.id },
          {
            action: 'edit',
            lineId: currentLines.find((line) => line.stockItemId === strawId)!.id,
            stockItemId: replacementId,
            childCardId: null,
            name: 'Трубочка широкая QA',
            unit: 'pcs',
            qtyBrutto: 2,
            lineRole: 'optional',
          },
          { action: 'delete', lineId: currentLines.find((line) => line.stockItemId === lidId)!.id },
        ],
        lines: [{
          stockItemId: syrupId,
          childCardId: null,
          name: 'Сироп для импорта QA',
          unit: 'ml',
          qty: 10,
          lineRole: 'base',
        }],
      }],
    })

    expect(result.status).toBe(200)
    const saved = await admin('GET', `/cost/tech-cards/${cardId}`)
    expect(saved.json.card.lines).toMatchObject([
      { stockItemId: syrupId, qtyBrutto: 10, lineRole: 'base' },
      { stockItemId: cupId, qtyBrutto: 1, lineRole: 'base' },
      { stockItemId: replacementId, qtyBrutto: 2, lineRole: 'optional' },
    ])
    expect(saved.json.card.lines).toHaveLength(3)
  })

  it('creates a new draft card and reuses a newly created ingredient within the batch', async () => {
    const result = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName: 'techcards.xlsx',
      recipes: [{
        name: 'Заготовка для теста QA',
        sourceSheet: 'Авторское',
        sourceRow: 4,
        targetCardId: null,
        expectedVersionId: null,
        newCardKind: 'semi',
        productId: null,
        outputQty: 100,
        outputUnit: 'g',
        methodText: null,
        lines: [
          {
            stockItemId: null,
            childCardId: null,
            name: 'Ингредиент новый QA',
            unit: 'g',
            qty: 5,
            lineRole: 'base',
            newItemPackageQty: 1000,
            newItemPackagePriceRub: 250,
          },
          {
            stockItemId: null,
            childCardId: null,
            name: 'Ингредиент новый QA',
            unit: 'g',
            qty: 10,
            lineRole: 'base',
            newItemPackageQty: 1000,
            newItemPackagePriceRub: 250,
          },
        ],
      }],
    })
    expect(result.status).toBe(200)
    const cardId = result.json.cards[0].id as number
    const card = await admin('GET', `/cost/tech-cards/${cardId}`)
    expect(card.json.card).toMatchObject({ name: 'Заготовка для теста QA', kind: 'semi', outputQty: 100, outputUnit: 'g', status: 'draft', importReviewCount: 1 })
    expect(card.json.card.lines).toHaveLength(2)
    expect(card.json.card.lines[0].stockItemId).toBe(card.json.card.lines[1].stockItemId)
    const createdItem = db.prepare(
      `SELECT package_qty AS packageQty, package_price_kop AS packagePriceKop, price_mode AS priceMode
         FROM stock_items WHERE id=?`,
    ).get(card.json.card.lines[0].stockItemId) as { packageQty: number; packagePriceKop: number; priceMode: string }
    expect(createdItem).toEqual({ packageQty: 1000, packagePriceKop: 25000, priceMode: 'manual' })
    expect(db.prepare(
      `SELECT cost_kop AS costKop, source FROM stock_item_cost_history WHERE stock_item_id=?`,
    ).get(card.json.card.lines[0].stockItemId)).toEqual({ costKop: 25, source: 'manual' })
    const ingredientCount = (db.prepare(
      `SELECT COUNT(*) AS count FROM stock_items WHERE name='Ингредиент новый QA' AND active=1`,
    ).get() as { count: number }).count
    expect(ingredientCount).toBe(1)
  })

  it('creates one warehouse item for the same ingredient reused across recipes', async () => {
    const sourceName = `shared-cream-${Date.now()}.xlsx`
    const result = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName,
      recipes: [
        {
          name: 'Рафа с общими сливками QA 1',
          sourceSheet: 'Напитки',
          sourceRow: 4,
          targetCardId: null,
          expectedVersionId: null,
          newCardKind: 'semi',
          productId: null,
          outputQty: 100,
          outputUnit: 'ml',
          methodText: null,
          lines: [{
            stockItemId: null,
            childCardId: null,
            name: 'Сливки 10% QA общий',
            unit: 'ml',
            qty: 30,
            lineRole: 'base',
            newItemPackageQty: 1000,
            newItemPackagePriceRub: 120,
          }],
        },
        {
          name: 'Рафа с общими сливками QA 2',
          sourceSheet: 'Напитки',
          sourceRow: 8,
          targetCardId: null,
          expectedVersionId: null,
          newCardKind: 'semi',
          productId: null,
          outputQty: 100,
          outputUnit: 'ml',
          methodText: null,
          lines: [{
            stockItemId: null,
            childCardId: null,
            name: 'сливки 10 % qa общий',
            unit: 'ml',
            qty: 40,
            lineRole: 'base',
            newItemPackageQty: 1000,
            newItemPackagePriceRub: 120,
          }],
        },
      ],
    })

    expect(result.status).toBe(200)
    const stockItemCount = (db.prepare(
      `SELECT COUNT(*) AS count FROM stock_items WHERE notes=?`,
    ).get(`Импорт ТТК: ${sourceName}`) as { count: number }).count
    expect(stockItemCount).toBe(1)

    const cardIds = result.json.cards.map((card: { id: number }) => card.id)
    const cards = await Promise.all(cardIds.map((id: number) => admin('GET', `/cost/tech-cards/${id}`)))
    const stockItemIds = cards.map((card) => card.json.card.lines[0].stockItemId)
    expect(stockItemIds[0]).toBeTruthy()
    expect(stockItemIds[0]).toBe(stockItemIds[1])

    const duplicateSourceName = `shared-cream-again-${Date.now()}.xlsx`
    const duplicateAttempt = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName: duplicateSourceName,
      recipes: [{
        name: 'Ещё один раф с теми же сливками QA',
        sourceSheet: 'Напитки',
        sourceRow: 12,
        targetCardId: null,
        expectedVersionId: null,
        newCardKind: 'semi',
        productId: null,
        outputQty: 100,
        outputUnit: 'ml',
        methodText: null,
        lines: [{
          stockItemId: null,
          childCardId: null,
          name: 'сливки 10 % qa общий',
          unit: 'ml',
          qty: 25,
          lineRole: 'base',
          newItemPackageQty: 1000,
          newItemPackagePriceRub: 120,
        }],
      }],
    })
    expect(duplicateAttempt.status).toBe(409)
    const stockItemCountAfterRetry = (db.prepare(
      `SELECT COUNT(*) AS count FROM stock_items WHERE notes=?`,
    ).get(`Импорт ТТК: ${sourceName}`) as { count: number }).count
    expect(stockItemCountAfterRetry).toBe(1)
    const retryCreatedItemCount = (db.prepare(
      `SELECT COUNT(*) AS count FROM stock_items WHERE notes=?`,
    ).get(`Импорт ТТК: ${duplicateSourceName}`) as { count: number }).count
    expect(retryCreatedItemCount).toBe(0)

    const conflictingSourceName = `shared-cream-conflict-${Date.now()}.xlsx`
    const conflictingImport = await admin('POST', '/cost/tech-cards/import/confirm', {
      sourceName: conflictingSourceName,
      recipes: [120, 121].map((packagePriceRub, index) => ({
        name: `Рафа конфликт сливки QA ${index + 1}`,
        sourceSheet: 'Напитки',
        sourceRow: 15 + index,
        targetCardId: null,
        expectedVersionId: null,
        newCardKind: 'semi',
        productId: null,
        outputQty: 100,
        outputUnit: 'ml',
        methodText: null,
        lines: [{
          stockItemId: null,
          childCardId: null,
          name: 'Сливки конфликт QA',
          unit: 'ml',
          qty: 25,
          lineRole: 'base',
          newItemPackageQty: 1000,
          newItemPackagePriceRub: packagePriceRub,
        }],
      })),
    })
    expect(conflictingImport.status).toBe(400)
    const conflictingItems = (db.prepare(
      `SELECT COUNT(*) AS count FROM stock_items WHERE notes=?`,
    ).get(`Импорт ТТК: ${conflictingSourceName}`) as { count: number }).count
    expect(conflictingItems).toBe(0)
  })
})
