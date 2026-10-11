/** Kopecks → "4,50" / "4" (same rule as the client app). */
export function fmtKop(kopecks: number | null | undefined): string {
  const k = Math.round(Number(kopecks) || 0)
  const sign = k < 0 ? '-' : ''
  const abs = Math.abs(k)
  const rub = Math.floor(abs / 100)
  const cents = abs % 100
  const whole = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return sign + (cents ? `${whole},${String(cents).padStart(2, '0')}` : whole)
}

/** Whole rubles / plain numbers with thin grouping. */
export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const text = Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "5 мин назад", "2 ч назад", "3 дн назад". */
export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return 'никогда'
  const min = Math.max(0, Math.floor((now - ms) / 60_000))
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} ч назад`
  return `${Math.floor(h / 24)} дн назад`
}

export const shortId = (s: string | null | undefined, n = 8) => (s ? s.slice(0, n) : '—')

export const DOC_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  PROCESSED: { label: 'Обработан', tone: 'ok' },
  FAILED: { label: 'Ошибка', tone: 'bad' },
  RECEIVED: { label: 'Получен', tone: 'warn' },
  PROCESSING: { label: 'В обработке', tone: 'warn' },
  IGNORED: { label: 'Пропущен', tone: 'neutral' },
}

export const DOC_TYPE: Record<string, string> = { SELL: 'Продажа', PAYBACK: 'Возврат', CORRECTION: 'Коррекция' }
