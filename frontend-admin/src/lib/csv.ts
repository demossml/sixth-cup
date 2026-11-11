/** CSV для выгрузок в админке: `;` как разделитель, кавычки по RFC 4180. */
const cell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsvText(head: string[], rows: unknown[][]): string {
  return [head, ...rows].map((r) => r.map(cell).join(';')).join('\n')
}

export function downloadCsv(filename: string, head: string[], rows: unknown[][]) {
  const blob = new Blob(['\ufeff' + toCsvText(head, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Имя файла с датой: customers-2026-10-25.csv */
export function csvName(base: string): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`
}

/**
 * P3-1: разбор CSV для импорта прайса. Понимает `;` и `,`, кавычки по RFC 4180,
 * BOM из Excel и переводы строк CRLF. Возвращает строки без пустых ячеек в конце.
 */
export function parseCsvText(text: string): string[][] {
  const src = text.replace(/^\ufeff/, '')
  // Разделитель определяем по первой непустой строке: в русских выгрузках чаще «;».
  // Считаем только разделители вне кавычек — иначе «Латте, 250»;220 уводит в запятые.
  const firstLine = src.split(/\r?\n/).find((l) => l.trim()) ?? ''
  let semicolons = 0
  let commas = 0
  let inQuotes = false
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i]
    if (ch === '"') {
      if (inQuotes && firstLine[i + 1] === '"') i++
      else inQuotes = !inQuotes
    } else if (!inQuotes && ch === ';') semicolons++
    else if (!inQuotes && ch === ',') commas++
  }
  const delim = semicolons >= commas ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
      continue
    }
    if (ch === delim) {
      row.push(cell.trim())
      cell = ''
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += ch
  }
  row.push(cell.trim())
  rows.push(row)
  return rows.filter((r) => r.some((c) => c !== ''))
}
