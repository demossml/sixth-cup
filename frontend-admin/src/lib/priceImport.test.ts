import { describe, expect, it } from 'vitest'
import { parseCsvText } from './csv'
import { parsePrice, parsePriceRows, priceRowText } from './priceImport'

describe('P3-1: разбор CSV', () => {
  it('понимает «;» и «,», кавычки и BOM из Excel', () => {
    expect(parseCsvText('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsvText('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsvText('\ufeff"Латте, 250";220\r\n')).toEqual([['Латте, 250', '220']])
  })

  it('кавычки внутри поля экранируются удвоением', () => {
    expect(parseCsvText('"Кафе ""6.7""";100')).toEqual([['Кафе "6.7"', '100']])
  })

  it('пустые строки пропускаются', () => {
    expect(parseCsvText('a;b\n\n\n1;2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('P3-1: прайс из CSV', () => {
  it('заголовок распознаётся и пропускается', () => {
    const res = parsePriceRows('Название;Цена;Объём\nЛатте;220;250 мл')
    expect(res.hasHeader).toBe(true)
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]).toMatchObject({ name: 'Латте', price: 220, volume: '250 мл', ok: true })
  })

  it('без заголовка первая строка — данные', () => {
    const res = parsePriceRows('Латте;220;250 мл')
    expect(res.hasHeader).toBe(false)
    expect(res.rows[0]!.ok).toBe(true)
  })

  it('ошибки построчно: нет названия, цена не число, цена отрицательная', () => {
    const res = parsePriceRows('Латте;220\n;100\nРаф;дорого\nЭспрессо;-5')
    expect(res.errorCount).toBe(3)
    expect(res.rows.map((r) => r.error)).toEqual([null, 'нет названия', 'цена «дорого» — не число', 'цена отрицательная'])
  })

  it('цена в «220 ₽» и «220,90» приводится к целому', () => {
    expect(parsePrice('220 ₽')).toBe(220)
    expect(parsePrice('220,90')).toBe(221)
    expect(parsePrice('1 200')).toBe(1200)
    expect(parsePrice('')).toBeNull()
  })

  it('объём необязателен, лишние колонки игнорируются', () => {
    const res = parsePriceRows('Латте;220;250 мл;комментарий')
    expect(res.rows[0]).toMatchObject({ ok: true, volume: '250 мл' })
  })

  it('строка на листе собирается из названия, объёма и цены', () => {
    expect(priceRowText({ line: 1, name: 'Латте', price: 220, volume: '250 мл', ok: true, error: null })).toBe(
      'Латте · 250 мл — 220 ₽',
    )
    expect(priceRowText({ line: 2, name: 'Раф', price: 260, volume: '', ok: true, error: null })).toBe('Раф — 260 ₽')
  })

  it('50 строк дают 50 блоков (критерий приёмки P3-1)', () => {
    const text = ['Название;Цена', ...Array.from({ length: 50 }, (_, i) => `Позиция ${i + 1};${100 + i}`)].join('\n')
    const res = parsePriceRows(text)
    expect(res.okCount).toBe(50)
    expect(res.errorCount).toBe(0)
  })
})
