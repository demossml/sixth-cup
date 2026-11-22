/** Типы и чистые функции экрана очереди — без React, чтобы их покрывали обычные unit-тесты. */

export type KitchenItem = {
  name: string
  qty: number
  mods: string[]
  note: string | null
}

export type KitchenStatus = 'new' | 'seen' | 'in_progress' | 'done' | 'cancelled'

export type KitchenOrder = {
  id: string
  storeUuid: string
  queueNumber: number | null
  clientOrderId: string
  status: KitchenStatus
  items: KitchenItem[]
  createdAt: number
  seenAt: number | null
  doneAt: number | null
}

export const STATUS_LABEL: Record<KitchenStatus, string> = {
  new: 'Новый',
  seen: 'Принят',
  in_progress: 'Готовится',
  done: 'Исполнен',
  cancelled: 'Отменён',
}

/** Моргание — только для новых и только когда бариста не выключил его в настройках. */
export function shouldBlink(order: Pick<KitchenOrder, 'status'>, alertBlink: boolean): boolean {
  return alertBlink && order.status === 'new'
}

/** «5 мин назад» — коротко и без склонений, чтобы строка не прыгала по ширине. */
export function ageLabel(createdAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000))
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`
}

/** Состав заказа одной строкой: «Капучино 350 ×2 · Овсяное, Ваниль». */
export function itemsSummary(order: Pick<KitchenOrder, 'items'>): string {
  return order.items
    .map((i) => {
      const mods = i.mods.length ? ` (${i.mods.join(', ')})` : ''
      return `${i.name} ×${i.qty}${mods}`
    })
    .join(' · ')
}

/** Очередь — FIFO: раньше создан, раньше готовится. */
export function sortOrders<T extends Pick<KitchenOrder, 'createdAt'>>(orders: T[]): T[] {
  return [...orders].sort((a, b) => a.createdAt - b.createdAt)
}

/** Номера, которых не было в предыдущем снимке — по ним вибрируем и показываем «новый». */
export function newOrderIds(prev: Array<Pick<KitchenOrder, 'id'>>, next: Array<Pick<KitchenOrder, 'id'>>): string[] {
  const known = new Set(prev.map((o) => o.id))
  return next.filter((o) => !known.has(o.id)).map((o) => o.id)
}
