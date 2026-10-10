export function formatMoneyRub(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n)
}

export function formatKopToRub(kop: number | null | undefined) {
  if (kop == null) return '—'
  return formatMoneyRub(kop / 100)
}

export function formatTs(ms: number | null | undefined) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('ru-RU')
}

export function shortId(id: string | null | undefined, n = 8) {
  if (!id) return '—'
  return id.length <= n ? id : id.slice(0, n)
}
