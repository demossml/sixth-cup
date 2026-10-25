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
