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
  estimateTotal: number
  currency: string
  cardId: string | null
  items: ItemOut[]
  warnings: string[]
}

export const ACTIVE_STATUSES: PreorderStatus[] = ['draft', 'accepted', 'cooking', 'ready']

export const ALLOWED_TRANSITIONS: Record<string, PreorderStatus[]> = {
  draft: ['accepted'],
  accepted: ['cooking'],
  cooking: ['ready'],
}
