import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { parseTechcardWorkbook } from './techcardImport'

function workbookBytes(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name)
  }
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

describe('parseTechcardWorkbook', () => {
  it('reads every sheet, splits serving sizes and preserves methods and source rows', () => {
    const bytes = workbookBytes({
      'Классика': [
        ['КЛАССИКА'],
        ['Капучино'],
        ['300мл'],
        ['Ингредиенты', '', 'Способ приготовления'],
        ['1. Молоко 230мл', '', 'Взбить и подать'],
        ['2. Сироп Ваниль 10мл'],
        ['400мл'],
        ['Ингредиенты'],
        ['1. Молоко 300мл'],
      ],
      'Авторское': [
        ['АВТОРСКОЕ'],
        ['Раф'],
        ['300мл'],
        ['Ингредиенты'],
        ['1. Сливки 250мл'],
      ],
    })

    const result = parseTechcardWorkbook(bytes)
    expect(result.warnings).toEqual([])
    expect(result.recipes.map((recipe) => recipe.name)).toEqual([
      'Капучино 300 мл',
      'Капучино 400 мл',
      'Раф 300 мл',
    ])
    expect(result.recipes[0]).toMatchObject({
      sourceSheet: 'Классика',
      sourceRow: 3,
      methodText: 'Взбить и подать',
      lines: [
        { ingredientName: 'Молоко', qty: 230, unit: 'ml', sourceRow: 5 },
        { ingredientName: 'Сироп Ваниль', qty: 10, unit: 'ml', sourceRow: 6 },
      ],
      issues: [],
    })
    expect(result.recipes[2]!.sourceSheet).toBe('Авторское')
  })

  it('blocks guessed ranges and missing measurements while retaining the source lines', () => {
    const bytes = workbookBytes({
      'Авторское': [
        ['РАФ'],
        ['Раф с халвой'],
        ['300мл'],
        ['Ингредиенты'],
        ['1. Сливки 250мл'],
        ['2. Заготовка халва Хг'],
        ['3. Лепестки розы 3-5г'],
      ],
    })

    const { recipes } = parseTechcardWorkbook(bytes)
    expect(recipes[0]!.lines).toMatchObject([
      { ingredientName: 'Сливки', qty: 250, unit: 'ml', issues: [] },
      { ingredientName: 'Заготовка халва Хг', qty: null, unit: null },
      { ingredientName: 'Лепестки розы', qty: null, unit: null },
    ])
    expect(recipes[0]!.issues).toEqual([
      'Строка 6: Не удалось однозначно определить количество и единицу измерения',
      'Строка 7: Диапазон количества «3-5г» — укажите одно точное значение',
    ])
  })

  it('normalizes single, double, and counted espresso shots to the shared card name', () => {
    const bytes = workbookBytes({
      'Классика': [
        ['КАПУЧИНО'],
        ['Капучино'],
        ['200мл'],
        ['Ингредиенты'],
        ['1. 2 шота эспрессо'],
        ['2. Двойной эспрессо'],
        ['3. 1 shot Espresso'],
        ['4. Single Espresso'],
      ],
    })

    const { recipes } = parseTechcardWorkbook(bytes)
    expect(recipes[0]!.lines).toMatchObject([
      { ingredientName: 'Espresso', qty: 2, unit: 'pcs', issues: [] },
      { ingredientName: 'Espresso', qty: 2, unit: 'pcs', issues: [] },
      { ingredientName: 'Espresso', qty: 1, unit: 'pcs', issues: [] },
      { ingredientName: 'Espresso', qty: 1, unit: 'pcs', issues: [] },
    ])
  })

  it('retains preparation blocks as semi-finished recipe candidates', () => {
    const bytes = workbookBytes({
      'Авторское': [
        ['Раф лавандовый'],
        ['300мл'],
        ['Ингредиенты', '', '', '', 'ЗАГОТОВКА'],
        ['1. Сливки 250мл', '', '', '', 'Цветки лаванды 3-5г'],
        ['', '', '', '', 'Ванильный сахар 20г'],
        ['', '', '', '', 'Измельчаем в кофемолке'],
        ['Раф с халвой', '', '', '', 'ЗАГОТОВКА'],
        ['', '', '', '', 'Халва'],
        ['', '', '', '', 'Белый сахар'],
      ],
    })

    const { recipes } = parseTechcardWorkbook(bytes)
    expect(recipes.map((recipe) => [recipe.name, recipe.kind])).toEqual([
      ['Раф лавандовый 300 мл', 'dish'],
      ['Заготовка для Раф лавандовый', 'semi'],
      ['Заготовка для Раф с халвой', 'semi'],
    ])
    expect(recipes[1]!.lines.map((line) => line.ingredientName)).toEqual(['Цветки лаванды', 'Ванильный сахар'])
    expect(recipes[1]!.methodText).toBe('Измельчаем в кофемолке')
    expect(recipes[2]!.lines.every((line) => line.issues.length > 0)).toBe(true)
  })
})
