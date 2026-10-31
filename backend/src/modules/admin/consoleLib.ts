/**
 * Pure helpers for the admin console (no DB, no HTTP) — covered by unit tests.
 */

export type HealthLevel = 'off' | 'ok' | 'warn' | 'bad'

export const HEALTH_DEFAULTS = { warnMin: 5, critMin: 30 } as const

/**
 * Till status shown in the admin header.
 * off  — sync is not enabled for the store (nothing is polled on purpose)
 * ok   — last successful poll is younger than warnMin
 * warn — warnMin…critMin minutes without a successful poll
 * bad  — older than critMin, never polled, or the store is in ERROR
 */
/**
 * Человеческий текст ошибки Эвотор для админки. Сырой `EvotorApiError` в интерфейсе бесполезен,
 * а `code:not_installed` — это не сбой сети, а отсутствие/неоплата приложения на точке.
 */
export function describeEvotorError(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (s.includes('not_installed') || s.includes('status=402')) {
    return 'Приложение Эвотор не установлено или не оплачено на этой точке — установите/продлите его в кабинете Эвотор'
  }
  if (s.includes('status=401')) return 'Токен Эвотор отклонён (401) — обновите токен в разделе «Касса» → «Токены»'
  if (/status=403/.test(s)) return 'Эвотор запретил доступ (403) — проверьте права токена в кабинете'
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(s)) {
    return 'Нет связи с облаком Эвотор — повторим автоматически'
  }
  if (s.includes('EVOTOR_API_TOKEN not set')) return 'Не задан токен Эвотор — добавьте его в разделе «Касса» → «Токены»'
  return s.length > 300 ? `${s.slice(0, 300)}…` : s
}

export function storeHealth(
  s: { enabled: boolean; status: string | null; lastOkAt: number | null },
  now: number,
  th: { warnMin: number; critMin: number } = HEALTH_DEFAULTS,
): { level: HealthLevel; ageMin: number | null; reason: string } {
  if (!s.enabled) return { level: 'off', ageMin: null, reason: 'Синхронизация выключена' }
  const ageMin = s.lastOkAt ? Math.max(0, Math.floor((now - s.lastOkAt) / 60_000)) : null
  if (s.status === 'ERROR') return { level: 'bad', ageMin, reason: 'Последний опрос завершился ошибкой' }
  if (ageMin === null) return { level: 'bad', ageMin, reason: 'Опросов ещё не было' }
  if (ageMin >= th.critMin) return { level: 'bad', ageMin, reason: `Нет успешного опроса ${ageMin} мин` }
  if (ageMin >= th.warnMin) return { level: 'warn', ageMin, reason: `Нет успешного опроса ${ageMin} мин` }
  return { level: 'ok', ageMin, reason: 'Опрос идёт' }
}

export function worstLevel(levels: HealthLevel[]): HealthLevel {
  const enabled = levels.filter((l) => l !== 'off')
  if (!enabled.length) return 'off'
  if (enabled.includes('bad')) return 'bad'
  if (enabled.includes('warn')) return 'warn'
  return 'ok'
}

const DAY = 86_400_000
export function periodSince(period: string | undefined, now: number): {
  period: '24h' | 'yesterday' | '7d' | '30d'
  since: number
  until?: number
} {
  if (period === '7d') return { period: '7d', since: now - 7 * DAY }
  if (period === '30d') return { period: '30d', since: now - 30 * DAY }
  if (period === 'yesterday') {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    const startToday = d.getTime()
    return { period: 'yesterday', since: startToday - DAY, until: startToday }
  }
  return { period: '24h', since: now - DAY }
}

/** Keyset cursor over (time, id): opaque base64url string. */
export function encodeCursor(t: number, id: string): string {
  return Buffer.from(JSON.stringify([t, id])).toString('base64url')
}
export function decodeCursor(raw: string | undefined): { t: number; id: string } | null {
  if (!raw) return null
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'string') return { t: v[0], id: v[1] }
  } catch {
    /* invalid cursor → first page */
  }
  return null
}

/** Escape a value for LIKE ... ESCAPE '\'. */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

/** CSV with a UTF-8 BOM (Excel) and protection from formula injection in text cells. */
export function toCsv(columns: { key: string; title: string }[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    let s = typeof v === 'string' ? v : String(v)
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const head = columns.map((c) => cell(c.title)).join(';')
  const body = rows.map((r) => columns.map((c) => cell(r[c.key])).join(';'))
  return '﻿' + [head, ...body].join('\r\n') + '\r\n'
}

export type ProductPatch = {
  available?: boolean
  categoryId?: number | null
  countsAsCup?: boolean
  freeEligible?: boolean
  price?: number
  priceDelta?: number
  pricePercent?: number
}

/** New price for a bulk price action. Rounds to whole units and never goes below zero. */
export function nextPrice(old: number, p: ProductPatch): number {
  if (typeof p.price === 'number') return Math.max(0, Math.round(p.price))
  if (typeof p.priceDelta === 'number') return Math.max(0, Math.round(old + p.priceDelta))
  if (typeof p.pricePercent === 'number') return Math.max(0, Math.round(old * (1 + p.pricePercent / 100)))
  return old
}

export type FieldChange = { field: string; from: unknown; to: unknown }

/** Compare a product row with the patch and list what would really change ("было → стало"). */
export function diffProduct(
  row: { price: number; available: number; category_id: number | null; counts_as_cup: number; free_eligible: number },
  p: ProductPatch,
): FieldChange[] {
  const out: FieldChange[] = []
  const price = nextPrice(row.price, p)
  if (price !== row.price) out.push({ field: 'price', from: row.price, to: price })
  if (p.available !== undefined && (p.available ? 1 : 0) !== row.available) out.push({ field: 'available', from: !!row.available, to: p.available })
  if (p.categoryId !== undefined && p.categoryId !== row.category_id) out.push({ field: 'categoryId', from: row.category_id, to: p.categoryId })
  if (p.countsAsCup !== undefined && (p.countsAsCup ? 1 : 0) !== row.counts_as_cup) out.push({ field: 'countsAsCup', from: !!row.counts_as_cup, to: p.countsAsCup })
  if (p.freeEligible !== undefined && (p.freeEligible ? 1 : 0) !== row.free_eligible) out.push({ field: 'freeEligible', from: !!row.free_eligible, to: p.freeEligible })
  return out
}
