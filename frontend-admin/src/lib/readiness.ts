/**
 * Подписи причин «касса не сможет продать» — одни и те же коды в API готовности
 * и в `configErrors` ответа `/api/devices/products/:id/configuration`.
 */
export const READINESS_REASON_LABEL: Record<string, string> = {
  no_store_link: 'не выгружено на эту точку (нет связи с Эвотором)',
  no_evotor_uuid: 'связь есть, но UUID Эвотора пустой — выгрузите заново',
  milk_scheme_empty: 'молоко обязательно, но выбранных вариантов нет',
  unavailable: 'выключено',
}

export const READINESS_KIND_LABEL: Record<string, string> = {
  product: 'Напиток',
  volume: 'Объём',
  milk: 'Молоко',
  addon: 'Добавка',
  volume_scheme: 'Схемы объёмов',
}

export const reasonLabel = (reason: string | null | undefined) =>
  reason ? READINESS_REASON_LABEL[reason] ?? reason : ''

export type NotReadyEntry = { kind: string; productId: number | null; name: string; reason: string }
export type Readiness = { storeUuid: string | null; cards: number; readyCards: number; notReady: NotReadyEntry[] }

export type CardReadiness = {
  productId: number
  name: string
  ready: boolean
  volumes: { productId: number; label: string; price: number; evotorUuid: string | null; ready: boolean; reason: string | null }[]
  milk: {
    schemeId: number | null
    required: boolean
    options: { name: string; isFree: boolean; evotorUuid: string | null; ready: boolean; reason: string | null }[]
  }
  addons: {
    schemeId: number | null
    options: { name: string; group: string; price: number; evotorUuid: string | null; ready: boolean; reason: string | null }[]
  }
  volumeScheme: { schemeId: number | null; items: { label: string; price: number }[] }
  notReady: NotReadyEntry[]
}
