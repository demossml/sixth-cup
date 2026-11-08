import { createRequire } from 'node:module'
/**
 * Разбор техкарты из текста / CSV / листа Excel.
 * Форматы:
 * 1) Широкий (как у 6.7): в ряд названия напитков, под каждым пары «ингредиент | 10 гр»
 * 2) Узкий CSV/TSV: recipe;ingredient;qty;unit
 * 3) Свободный текст: блок «НАЗВАНИЕ» и строки «кофе молотый — 10 г»
 */

export type ParsedLine = {
  ingredientName: string
  qty: number
  unit: 'g' | 'ml' | 'pcs'
  lineRole: 'base' | 'optional'
}

export type ParsedRecipe = {
  name: string
  outputLabel: string | null
  methodText: string | null
  lines: ParsedLine[]
}

const UNIT_MAP: Record<string, 'g' | 'ml' | 'pcs'> = {
  г: 'g',
  гр: 'g',
  g: 'g',
  кг: 'g',
  kg: 'g',
  мл: 'ml',
  ml: 'ml',
  л: 'ml',
  l: 'ml',
  шт: 'pcs',
  pcs: 'pcs',
}

export function normalizeUnit(raw: string): 'g' | 'ml' | 'pcs' | null {
  const k = raw.trim().toLowerCase().replace(/\./g, '')
  if (UNIT_MAP[k]) return UNIT_MAP[k]
  if (k.startsWith('гр')) return 'g'
  if (k.startsWith('мл')) return 'ml'
  return null
}

/** «10 гр», «150 мл», «1 шт», «0,7 л» → qty в базовых единицах (г/мл/шт) */
export function parseQtyUnit(cell: string): { qty: number; unit: 'g' | 'ml' | 'pcs' } | null {
  const s = String(cell || '').trim().toLowerCase().replace(',', '.')
  if (!s) return null
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(кг|kg|г|гр|g|мл|ml|л|l|шт\.?|pcs)?/i)
  if (!m) return null
  let qty = parseFloat(m[1])
  if (!Number.isFinite(qty) || qty <= 0) return null
  const uRaw = (m[2] || 'шт').toLowerCase()
  let unit = normalizeUnit(uRaw) || 'pcs'
  if (uRaw === 'кг' || uRaw === 'kg') qty *= 1000
  if (uRaw === 'л' || uRaw === 'l') {
    unit = 'ml'
    qty *= 1000
  }
  return { qty, unit }
}

function isMethodHeader(s: string): boolean {
  return /способ\s+приготовления/i.test(s)
}

function looksLikeDrinkTitle(s: string): boolean {
  const t = s.trim()
  if (t.length < 2 || t.length > 80) return false
  if (parseQtyUnit(t)) return false
  if (isMethodHeader(t)) return false
  if (/^(итого|сумма|№|n\s*п)/i.test(t)) return false
  return true
}

/** Широкая матрица: row0 titles in even cols or every col pair */
export function parseWideMatrix(rows: string[][]): ParsedRecipe[] {
  if (!rows.length) return []
  // find header row: many non-empty title-like cells
  let headerIdx = 0
  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const nonempty = rows[r].filter((c) => String(c || '').trim()).length
    if (nonempty >= 2) {
      headerIdx = r
      break
    }
  }
  const header = rows[headerIdx] || []
  // columns: either [name, qty, name, qty...] or [title spanning pairs]
  type Col = { title: string; nameCol: number; qtyCol: number }
  const cols: Col[] = []
  for (let c = 0; c < header.length; c++) {
    const h = String(header[c] || '').trim()
    if (!h) continue
    if (looksLikeDrinkTitle(h) && !parseQtyUnit(h)) {
      // prefer pair: this col = ingredient names, next = qty (if next header empty or same section)
      const next = String(header[c + 1] || '').trim()
      if (!next || parseQtyUnit(next) || !looksLikeDrinkTitle(next)) {
        cols.push({ title: h, nameCol: c, qtyCol: c + 1 })
        c++ // skip qty col
      } else {
        cols.push({ title: h, nameCol: c, qtyCol: c })
      }
    }
  }
  // fallback: treat each non-empty header as title with name+qty in same column alternating rows — skip
  if (!cols.length) {
    for (let c = 0; c < header.length; c++) {
      const h = String(header[c] || '').trim()
      if (looksLikeDrinkTitle(h)) cols.push({ title: h, nameCol: c, qtyCol: c })
    }
  }

  const recipes: ParsedRecipe[] = cols.map((col) => ({
    name: col.title,
    outputLabel: extractVolumeLabel(col.title),
    methodText: null as string | null,
    lines: [] as ParsedLine[],
  }))

  let modeMethod = false
  const methodBuf: string[][] = cols.map(() => [])

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const joined = row.map((x) => String(x || '').trim()).filter(Boolean).join(' ')
    if (isMethodHeader(joined) || row.some((c) => isMethodHeader(String(c || '')))) {
      modeMethod = true
      continue
    }
    cols.forEach((col, i) => {
      if (modeMethod) {
        const t = String(row[col.nameCol] || row[col.qtyCol] || '').trim()
        if (t) methodBuf[i].push(t)
        return
      }
      const nameCell = String(row[col.nameCol] || '').trim()
      const qtyCell =
        col.qtyCol === col.nameCol
          ? ''
          : String(row[col.qtyCol] || '').trim()
      if (!nameCell && !qtyCell) return
      // same cell "кофе 10 г"
      if (nameCell && !qtyCell) {
        const inline = nameCell.match(/^(.+?)\s+(\d+(?:[.,]\d+)?\s*(?:кг|kg|г|гр|g|мл|ml|л|l|шт\.?))\s*$/i)
        if (inline) {
          const pu = parseQtyUnit(inline[2])
          if (pu) {
            recipes[i].lines.push({
              ingredientName: cleanIngName(inline[1]),
              qty: pu.qty,
              unit: pu.unit,
              lineRole: 'base',
            })
            return
          }
        }
        // bare name without qty — skip
        return
      }
      if (nameCell && qtyCell) {
        const pu = parseQtyUnit(qtyCell)
        if (!pu) return
        if (isMethodHeader(nameCell)) return
        recipes[i].lines.push({
          ingredientName: cleanIngName(nameCell),
          qty: pu.qty,
          unit: pu.unit,
          lineRole: /по\s+желанию|опцион/i.test(nameCell) ? 'optional' : 'base',
        })
      }
    })
  }
  recipes.forEach((rec, i) => {
    if (methodBuf[i].length) rec.methodText = methodBuf[i].join('\n').slice(0, 4000)
  })
  return recipes.filter((r) => r.lines.length > 0 || r.methodText)
}

function cleanIngName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 120)
}

function extractVolumeLabel(title: string): string | null {
  const m = title.match(/(\d+)\s*мл/i)
  if (m) return `${m[1]} мл`
  const m2 = title.match(/\b(\d{2,3})\s*$/)
  if (m2 && Number(m2[1]) <= 600) return `${m2[1]} мл`
  return null
}

/** recipe;ingredient;qty;unit or CSV */
export function parseNarrowCsv(text: string): ParsedRecipe[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const map = new Map<string, ParsedRecipe>()
  for (const line of lines) {
    if (/^recipe[;,\t]/i.test(line)) continue
    const parts = line.split(/[;\t,]/).map((p) => p.trim())
    if (parts.length < 3) continue
    const [recipeName, ingName, qtyRaw, unitRaw] = parts
    if (!recipeName || !ingName) continue
    const pu =
      parseQtyUnit(`${qtyRaw} ${unitRaw || ''}`.trim()) ||
      parseQtyUnit(qtyRaw)
    if (!pu) continue
    if (!map.has(recipeName)) {
      map.set(recipeName, {
        name: recipeName,
        outputLabel: extractVolumeLabel(recipeName),
        methodText: null,
        lines: [],
      })
    }
    map.get(recipeName)!.lines.push({
      ingredientName: cleanIngName(ingName),
      qty: pu.qty,
      unit: unitRaw ? normalizeUnit(unitRaw) || pu.unit : pu.unit,
      lineRole: 'base',
    })
  }
  return [...map.values()]
}

/** Блоки «КАПУЧИНО 200» + строки состава */
export function parseFreeformBlocks(text: string): ParsedRecipe[] {
  const recipes: ParsedRecipe[] = []
  let cur: ParsedRecipe | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (isMethodHeader(line)) continue
    const qtyInline = line.match(/^(.+?)[\s—\-–]+(\d+(?:[.,]\d+)?\s*(?:кг|г|гр|мл|л|шт\.?))/i)
    if (qtyInline && cur) {
      const pu = parseQtyUnit(qtyInline[2])
      if (pu) {
        cur.lines.push({
          ingredientName: cleanIngName(qtyInline[1]),
          qty: pu.qty,
          unit: pu.unit,
          lineRole: 'base',
        })
        continue
      }
    }
    if (looksLikeDrinkTitle(line) && !parseQtyUnit(line) && line === line.toUpperCase().replace(/[a-z]/g, (ch) => ch) || /\d/.test(line)) {
      // new recipe header if ALL CAPS or contains volume
      if (/[А-ЯA-Z]{3,}/.test(line) || /\d+\s*мл|\d{2,3}\s*$/i.test(line)) {
        cur = {
          name: line,
          outputLabel: extractVolumeLabel(line),
          methodText: null,
          lines: [],
        }
        recipes.push(cur)
        continue
      }
    }
    if (looksLikeDrinkTitle(line) && (/\d/.test(line) || line.length > 5) && !qtyInline) {
      cur = {
        name: line,
        outputLabel: extractVolumeLabel(line),
        methodText: null,
        lines: [],
      }
      recipes.push(cur)
    }
  }
  return recipes.filter((r) => r.lines.length > 0)
}

export function parseTechcardText(text: string): ParsedRecipe[] {
  const t = text.trim()
  if (!t) return []
  // narrow csv?
  if ((t.includes(';') || t.includes('\t')) && /recipe|рецепт/i.test(t.split('\n')[0] || '')) {
    const narrow = parseNarrowCsv(t)
    if (narrow.length) return narrow
  }
  if (t.includes(';') && t.split('\n').filter((l) => l.split(';').length >= 3).length >= 2) {
    const narrow = parseNarrowCsv(t)
    if (narrow.length) return narrow
  }
  // matrix from TSV paste
  if (t.includes('\t')) {
    const rows = t.split(/\r?\n/).map((l) => l.split('\t').map((c) => c.trim()))
    const wide = parseWideMatrix(rows)
    if (wide.length) return wide
  }
  const free = parseFreeformBlocks(t)
  if (free.length) return free
  return parseNarrowCsv(t)
}

export function sheetToRows(data: ArrayBuffer): string[][] {
  const req = createRequire(import.meta.url)
  const XLSX = req('xlsx') as typeof import('xlsx')
  const wb = XLSX.read(Buffer.from(data), { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
  return rows.map((r) => r.map((c) => String(c ?? '').trim()))
}

export function parseTechcardBuffer(data: ArrayBuffer, filename: string): ParsedRecipe[] {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    const text = new TextDecoder('utf-8').decode(data)
    return parseTechcardText(text)
  }
  const rows = sheetToRows(data)
  const wide = parseWideMatrix(rows)
  if (wide.length) return wide
  // flatten rows to text
  return parseTechcardText(rows.map((r) => r.join('\t')).join('\n'))
}
