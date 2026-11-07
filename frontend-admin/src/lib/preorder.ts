/** Чистая логика экрана «Предзаказы»: подписи статусов, остаток ETA, баны. */

export type PreorderStatus = 'draft' | 'accepted' | 'cooking' | 'ready' | 'paid' | 'cancelled' | 'rejected' | 'expired'

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Ждёт подтверждения',
  accepted: 'Принят',
  cooking: 'Готовится',
  ready: 'Готов',
  paid: 'Оплачен',
  cancelled: 'Отменён',
  rejected: 'Отклонён',
  expired: 'Истёк',
}

export const statusLabel = (s: string): string => STATUS_LABEL[s] ?? s

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad'

export const STATUS_TONE: Record<string, Tone> = {
  draft: 'warn',
  accepted: 'neutral',
  cooking: 'neutral',
  ready: 'ok',
  paid: 'ok',
  cancelled: 'neutral',
  rejected: 'bad',
  expired: 'bad',
}

export const statusTone = (s: string): Tone => STATUS_TONE[s] ?? 'neutral'

/** Какие кнопки статусов доступны (ровно те же переходы, что разрешает backend). */
export function nextActions(status: string): { value: 'accepted' | 'cooking' | 'ready'; label: string }[] {
  if (status === 'draft') return [{ value: 'accepted', label: 'Принять' }]
  if (status === 'accepted') return [{ value: 'cooking', label: 'Готовится' }, { value: 'ready', label: 'Готов' }]
  if (status === 'cooking') return [{ value: 'ready', label: 'Готов' }]
  return []
}

/** Остаток до готовности в секундах (по серверному `now`, а не по часам браузера). */
export function etaLeftSec(etaReadyAt: number | null | undefined, serverNow: number | null | undefined): number | null {
  if (!etaReadyAt) return null
  const now = serverNow ?? Math.floor(Date.now() / 1000)
  return Math.max(0, Math.round(etaReadyAt - now))
}

export function etaText(etaReadyAt: number | null | undefined, serverNow: number | null | undefined): string {
  const left = etaLeftSec(etaReadyAt, serverNow)
  if (left == null) return '—'
  if (left <= 0) return 'вот-вот'
  const minutes = Math.ceil(left / 60)
  return `~${minutes} мин`
}

/** Подпись ETA в строке заказа: у готового/оплаченного обратный отсчёт уже не нужен. */
export function etaLabel(status: string, etaReadyAt: number | null | undefined, serverNow: number | null | undefined): string {
  if (status === 'ready') return 'готов, ждём гостя'
  if (status === 'paid') return 'ждём гостя'
  if (status === 'accepted' || status === 'cooking') return etaText(etaReadyAt, serverNow)
  return '—'
}

/** Остаток бана в часах/минутах до указанного момента (секунды эпохи). */
export function banText(until: number | null | undefined, now = Math.floor(Date.now() / 1000)): string {
  if (!until) return '—'
  const left = Math.max(0, Math.round(until - now))
  if (left <= 0) return 'истёк'
  const h = Math.floor(left / 3600)
  const m = Math.floor((left % 3600) / 60)
  if (h > 0) return `${h} ч ${m} мин`
  return `${Math.max(1, m)} мин`
}

/** ISO-строка для подписи «до» в бане. */
export function banUntilText(until: number | null | undefined): string {
  if (!until) return '—'
  return new Date(until * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
