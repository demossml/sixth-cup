import type { OrderOut } from './preorderApi'

/**
 * Чистая логика баннера заказа: подписи статусов и обратный отсчёт.
 * Вынесено из компонента, чтобы покрыть тестами без DOM.
 */

const pluralMinutes = (n: number) => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} минуту`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} минуты`
  return `${n} минут`
}

/** Сколько секунд осталось до готовности. Считаем от серверного «сейчас», а не от часов телефона. */
export function etaLeftSec(order: OrderOut | null, now = Date.now()): number | null {
  if (!order?.etaReadyAt) return null
  const eta = new Date(order.etaReadyAt).getTime()
  if (!Number.isFinite(eta)) return null
  const serverNow = order.serverNow ? new Date(order.serverNow).getTime() : now
  const skew = Number.isFinite(serverNow) ? serverNow - now : 0
  return Math.max(0, Math.round((eta - (now + skew)) / 1000))
}

export type BannerState = {
  label: string
  detail: string
  /** Заполненных сегментов шкалы (0…4). */
  filled: number
  /** Акцентная заливка (готов/оплачен). */
  accent: boolean
}

export function bannerState(order: OrderOut, now = Date.now()): BannerState {
  const left = etaLeftSec(order, now)
  const minutes = left == null ? null : Math.max(0, Math.ceil(left / 60))
  const leftText = left != null && left > 0 ? pluralMinutes(minutes ?? 0) : null

  switch (order.status) {
    case 'draft': {
      const ttl = Math.max(0, Math.round((new Date(order.expiresAt).getTime() - now) / 1000))
      const mm = String(Math.floor(ttl / 60)).padStart(2, '0')
      const ss = String(ttl % 60).padStart(2, '0')
      return { label: 'Ждём подтверждения', detail: `в кофейне · ${mm}:${ss}`, filled: 1, accent: false }
    }
    case 'accepted':
      return { label: 'Принят', detail: leftText ? `готовим · ${leftText}` : 'готовим', filled: 2, accent: false }
    case 'cooking':
      return { label: 'Готовится', detail: leftText ? `через ${leftText}` : 'уточняем время', filled: 3, accent: false }
    case 'ready':
      return { label: 'Готов — забирайте', detail: 'подойдите к кассе', filled: 4, accent: true }
    case 'paid':
      return { label: 'Оплачен', detail: 'назовите номер бариста', filled: 4, accent: true }
    default:
      return { label: 'Заказ закрыт', detail: '', filled: 0, accent: false }
  }
}

/** Бан за невыкуп: сколько осталось и стоит ли вообще показывать плашку. */
export function banLeftSec(bannedUntil: string | null | undefined, now = Date.now()): number {
  if (!bannedUntil) return 0
  const until = new Date(bannedUntil).getTime()
  if (!Number.isFinite(until)) return 0
  return Math.max(0, Math.round((until - now) / 1000))
}

export function banText(seconds: number): string {
  if (seconds <= 0) return ''
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours} ч ${minutes} мин`
  return pluralMinutes(Math.max(1, minutes))
}
