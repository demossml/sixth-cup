/** Типы и вызовы API «Себестоимость + техкарта» (F5). Один файл, чтобы страница не знала про URL. */
import { api } from '../api/client'

export type Unit = 'kg' | 'l' | 'pcs' | 'g' | 'ml'
export type CardKind = 'dish' | 'semi' | 'modifier'
export type WriteOffMode = 'ingredients' | 'semi' | 'semi_then_ingredients' | 'none'

export type Insight = { code: string; text: string; tone: 'bad' | 'warn' | 'info' }

export type CardListItem = {
  id: number
  name: string
  kind: CardKind
  status: 'draft' | 'active' | 'archived'
  productId: number | null
  outputQty: number
  outputUnit: Unit
  costPerUnitRub: number | null
  retailRub: number | null
  foodCostPct: number | null
  marginRub: number | null
  linesCount: number
  version: { id: number; validFrom: number } | null
  insights: Insight[]
}

export type CardLine = {
  id: number
  stockItemId: number | null
  stockItemName: string | null
  itemUnit: Unit | null
  childCardId: number | null
  childCardName: string | null
  qtyBrutto: number
  lossColdPct: number
  lossHotPct: number
  qtyNetto: number
  qtyYield: number
  computed: string[]
  warnings: string[]
  lineRole: 'base' | 'optional'
  unitCostRub: number | null
  costSource: string
  lineCostRub: number | null
}

export type TechCard = {
  id: number
  name: string
  kind: CardKind
  outputQty: number
  outputUnit: Unit
  productId: number | null
  status: 'draft' | 'active' | 'archived'
  writeOffMode: WriteOffMode
  retailPriceRub: number | null
  markupPct: number
  methodText: string | null
  version: { id: number; validFrom: number; note: string | null } | null
  versions: { id: number; validFrom: number; note: string | null; active: boolean }[]
  costRub: number | null
  costPerUnitRub: number | null
  optionalRub: number | null
  retailRub: number | null
  retailCalcRub: number | null
  foodCostPct: number | null
  marginRub: number | null
  missingPrices: boolean
  insights: Insight[]
  lines: CardLine[]
}

export type CostItem = {
  id: number
  name: string
  unit: Unit
  kind: string
  weightPerPcKg: number | null
  densityKgL: number | null
  manualCostRub: number | null
  costRub: number | null
  costSource: 'invoice' | 'history' | 'manual' | 'none'
  cards: number
  notes: string | null
  problems: string[]
}

export type LinePayload = {
  stockItemId?: number | null
  childCardId?: number | null
  qtyBrutto: number
  lossColdPct?: number
  lossHotPct?: number
  qtyNetto?: number | null
  qtyYield?: number | null
  lineRole?: 'base' | 'optional'
}

export type CardPayload = {
  name?: string
  kind?: CardKind
  outputQty?: number
  outputUnit?: Unit
  productId?: number | null
  methodText?: string | null
  writeOffMode?: WriteOffMode
  retailPriceRub?: number | null
  markupPct?: number
  lines?: LinePayload[]
}

const qs = (params: Record<string, string | number | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

export const costApi = {
  cards: (params: { q?: string; kind?: string; problems?: boolean } = {}) =>
    api<{ cards: CardListItem[]; totals: { cards: number; problems: number } }>(
      `/cost/tech-cards${qs({ q: params.q, kind: params.kind, problems: params.problems ? 1 : undefined })}`,
    ),
  card: (id: number, versionId?: number) =>
    api<{ card: TechCard }>(`/cost/tech-cards/${id}${qs({ versionId })}`),
  create: (body: CardPayload) => api<{ card: TechCard }>('/cost/tech-cards', { method: 'POST', body }),
  update: (id: number, body: CardPayload, versionId?: number) =>
    api<{ card: TechCard }>(`/cost/tech-cards/${id}${qs({ versionId })}`, { method: 'PUT', body }),
  newVersion: (id: number, body: { validFrom?: number; note?: string }) =>
    api<{ card: TechCard; versionId: number }>(`/cost/tech-cards/${id}/versions`, { method: 'POST', body }),
  publish: (id: number) =>
    api<{ card: TechCard; projection: { norms: number; costKop: number | null } }>(
      `/cost/tech-cards/${id}/publish`,
      { method: 'POST', body: {} },
    ),
  remove: (id: number) => api(`/cost/tech-cards/${id}`, { method: 'DELETE' }),
  usage: (id: number) =>
    api<{ usage: { cardId: number; name: string; kind: string; qty: number; costPerUnitRub: number | null }[] }>(
      `/cost/tech-cards/${id}/usage`,
    ),
  items: (params: { q?: string; problems?: boolean } = {}) =>
    api<{ items: CostItem[] }>(`/cost/items${qs({ q: params.q, problems: params.problems ? 1 : undefined })}`),
  /** Новая позиция склада — чтобы не уходить со страницы себестоимости. */
  createItem: (body: { name: string; unit: Unit; kind?: 'raw' | 'unit' }) =>
    api<{ id: number }>('/stock/items', { method: 'POST', body }),
  updateItem: (id: number, body: { manualCostRub?: number | null; weightPerPcKg?: number | null; densityKgL?: number | null; notes?: string | null }) =>
    api(`/cost/items/${id}`, { method: 'PUT', body }),
  duplicates: () =>
    api<{
      groups: {
        key: string
        name: string
        unit: Unit
        items: { id: number; name: string; costRub: number | null; costSource: string; cards: number }[]
        suggestedKeepId: number
      }[]
      total: number
    }>('/cost/items/duplicates'),
  mergeItems: (keepId: number, mergeIds: number[]) =>
    api<{ merged: number; moved: Record<string, number> }>('/cost/items/merge', {
      method: 'POST',
      body: { keepId, mergeIds },
    }),
  priceHistory: (id: number) =>
    api<{ history: { at: number; costRub: number | null; source: string }[]; purchases: { at: number; qty: number; unitCostRub: number | null; number: string | null }[] }>(
      `/cost/items/${id}/price-history`,
    ),
  insights: () =>
    api<{ rows: { cardId: number; name: string; code: string; text: string; tone: 'bad' | 'warn' | 'info' }[]; summary: { code: string; count: number }[] }>(
      '/cost/insights',
    ),
  overview: () =>
    api<{
      cards: { id: number; name: string; kind: CardKind; status: string; costPerUnitRub: number | null; retailRub: number | null; foodCostPct: number | null; marginRub: number | null; insights: Insight[] }[]
      avgFoodCostPct: number | null
      problems: number
      cardsTotal: number
    }>('/cost/overview'),
  bulkReplace: (body: { fromStockItemId: number; toStockItemId: number; factor?: number; cardIds?: number[] }) =>
    api<{ cards: number; lines: number }>('/cost/bulk/replace-ingredient', { method: 'POST', body }),
  bulkLoss: (body: { cardIds: number[]; stockItemId?: number; lossColdPct: number; lossHotPct?: number }) =>
    api<{ lines: number }>('/cost/bulk/loss-pct', { method: 'POST', body }),
}
