/**
 * P3-1: импорт прайса из CSV — позиции, которых нет в каталоге.
 *
 * Правила простые и проверяемые: название обязательно, цена — целое ≥ 0,
 * объём необязателен. Ошибки показываем построчно, а не «файл не подошёл».
 */
import { parseCsvText } from './csv'

export type PriceRow = {
  /** Номер строки в файле (1 — первая строка данных, заголовок не считается). */
  line: number
  name: string
  price: number
  volume: string
  /** Готова ли строка к импорту. */
  ok: boolean
  error: string | null
}

export type PriceParseResult = {
  rows: PriceRow[]
  /** Заголовок распознан и пропущен. */
  hasHeader: boolean
  /** Сколько строк готово / с ошибками. */
  okCount: number
  errorCount: number
}

const HEADER_HINTS = ['назван', 'позиц', 'name', 'товар', 'цена', 'price', 'объ']

const isHeader = (cells: string[]): boolean => {
  const joined = cells.join(' ').toLowerCase()
  return HEADER_HINTS.some((h) => joined.includes(h))
}

/** Цена «220», «220 ₽», «220,50» → число; иначе null. Копейки округляем. */
export const parsePrice = (raw: string): number | null => {
  const cleaned = raw.replace(/[^\d,.-]/g, '').replace(',', '.')
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value)
}

/**
 * Разбор текста прайса. Колонки: название, цена, объём (необязательно).
 * Заголовок распознаём по словам «название/цена/объём/name/price» — и пропускаем.
 */
export function parsePriceRows(text: string): PriceParseResult {
  const table = parseCsvText(text)
  const hasHeader = table.length > 0 && isHeader(table[0]!)
  const data = hasHeader ? table.slice(1) : table
  const rows: PriceRow[] = data.map((cells, index) => {
    const [rawName = '', rawPrice = '', rawVolume = ''] = cells
    const name = rawName.trim()
    const volume = rawVolume.trim()
    const price = parsePrice(rawPrice)
    let error: string | null = null
    if (!name) error = 'нет названия'
    else if (name.length > 120) error = 'название длиннее 120 символов'
    else if (rawPrice.trim() === '') error = 'нет цены'
    else if (price == null) error = `цена «${rawPrice}» — не число`
    else if (price < 0) error = 'цена отрицательная'
    else if (volume.length > 20) error = 'объём длиннее 20 символов'
    return {
      line: index + 1,
      name,
      price: price ?? 0,
      volume,
      ok: error == null,
      error,
    }
  })
  return {
    rows,
    hasHeader,
    okCount: rows.filter((r) => r.ok).length,
    errorCount: rows.filter((r) => !r.ok).length,
  }
}

/** Как строка прайса выглядит на листе: «Латте · 250 мл — 220 ₽». */
export const priceRowText = (row: PriceRow): string =>
  `${row.name}${row.volume ? ` · ${row.volume}` : ''} — ${row.price} ₽`
