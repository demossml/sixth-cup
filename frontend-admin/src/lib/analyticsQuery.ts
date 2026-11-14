import { qs } from './query'

/**
 * Сборка адреса для `/analytics/*` с гарантией одного `?`.
 *
 * `qs()` уже возвращает строку, начинающуюся с `?`. Если её приклеить к пути,
 * в котором `?` уже стоит (`/analytics/series?${qs(...)}`), получается
 * `/analytics/series??period=7d`: сервер видит параметр с именем `?period`,
 * фильтр «молча» не применяется и блоки экрана живут в разных периодах
 * (ряд — 24 ч, обзор — 30 дн). Поэтому адреса аналитики собираются только здесь.
 */
export function analyticsPath(
  endpoint: '/analytics/series' | '/analytics/by-store' | '/analytics/overview' | '/analytics/heatmap',
  params: { period?: string | null; storeUuid?: string | null } = {},
): string {
  const query = qs({ period: params.period ?? undefined, storeUuid: params.storeUuid || undefined })
  return `${endpoint}${query}`
}

const PERIOD_LABEL: Record<string, string> = {
  '24h': 'за 24 часа',
  yesterday: 'за вчера',
  '7d': 'за 7 дней',
  '30d': 'за 30 дней',
  today: 'за сегодня',
}

/** Подпись периода для заголовков блоков, чтобы на одном экране не смешивались окна. */
export function periodLabel(period: string | null | undefined): string {
  if (!period) return ''
  return PERIOD_LABEL[period] ?? `за ${period}`
}
