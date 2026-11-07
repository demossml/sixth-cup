/** Pre-order API types (PWA guest + Evotor device). Money: integer rubles. */

export type PreorderStatus =
  | 'draft'
  | 'accepted'
  | 'cooking'
  | 'ready'
  | 'paid'
  | 'cancelled'
  | 'rejected'
  | 'expired'

export type ModifierIn = {
  groupKey: string
  modifierId: string
  /** Локальный товар модификатора (если клиент знает) — нужен для UUID на точке. */
  productId?: number | null
  /** Подпись для чека/кассы («Кокосовое молоко»). */
  name?: string | null
  /** Справочная цена; финальную считает касса. */
  priceRub?: number | null
}

export type ItemIn = {
  productId: string
  quantity: number
  volumeId?: string | null
  modifiers?: ModifierIn[]
}

export type CreateOrderBody = {
  storeId: number | string
  cardId?: string | null
  items: ItemIn[]
}

export type ModifierOut = {
  group: string
  id: string
  name: string
  priceEstimate: number
  sendToReceipt: boolean
  /** UUID товара-модификатора на точке (null — нет связи, касса добавит вручную). */
  evotorUuid: string | null
}

export type ItemOut = {
  lineId: string
  productId: string
  evotorProductUuid: string | null
  name: string
  quantity: number
  volumeLabel: string | null
  configText: string
  unitPriceEstimate: number
  modifiers: ModifierOut[]
}

export type OrderOut = {
  id: string
  shortCode: string
  storeId: number
  status: PreorderStatus
  createdAt: string
  expiresAt: string
  /** Когда заказ будет готов (null — ETA ещё не назначен). */
  etaReadyAt: string | null
  /** Сколько минут осталось до готовности на момент ответа (null — неизвестно). */
  etaMinutes: number | null
  /** Серверное «сейчас»: клиент считает обратный отсчёт от него, а не от часов телефона. */
  serverNow: string
  /** Когда гость забрал заказ (только для paid). */
  pickedUpAt: string | null
  /** Кто перевёл в «готов»: авто по ETA или кассир. */
  readyBy: 'auto' | 'cashier' | null
  estimateTotal: number
  currency: string
  cardId: string | null
  items: ItemOut[]
  warnings: string[]
}

export const ACTIVE_STATUSES: PreorderStatus[] = ['draft', 'accepted', 'cooking', 'ready']

export const ALLOWED_TRANSITIONS: Record<string, PreorderStatus[]> = {
  draft: ['accepted'],
  // Кассир может сразу подтвердить готовность: ETA — прогноз, а не запрет.
  accepted: ['cooking', 'ready'],
  cooking: ['ready'],
}
