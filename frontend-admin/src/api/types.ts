export type Level = 'off' | 'ok' | 'warn' | 'bad'

export type StoreHealth = {
  uuid: string
  name: string | null
  enabled: boolean
  status: string | null
  lastError: string | null
  lastFastAt: number | null
  outboxPending: number
  outboxWithError: number
  failedDocs: number
  level: Level
  ageMin: number | null
  reason: string
}
export type Health = { thresholds: { warnMin: number; critMin: number }; level: Level; stores: StoreHealth[] }

export type OperationRow = {
  storeUuid: string
  storeName: string | null
  docId: string
  type: string
  status: 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'IGNORED' | 'FAILED'
  attempts: number
  lastError: string | null
  closedAt: number
  receivedAt: number
  processedAt: number | null
  source: string
  number: number | null
  opKind: string | null
  cups: number | null
  free: number | null
  cashbackKopecks: number | null
  resultRub: number | null
  opClaimed: string | null
  qClaimed: number | null
  cardId: string | null
  userId: number | null
  cardCode: string | null
  nickname: string | null
}

export type Dashboard = {
  now: number
  period: '24h' | '7d' | '30d'
  health: Health
  docs: { sell: number; sellFailed: number; payback: number; paybackFailed: number }
  ops: { sells: number; paybacks: number; cups: number; cupsReturned: number; free: number; cashbackKopecks: number; resultRub: number; lastOpAt: number | null }
  sellWithoutCard: number
  customers: number
  newCustomers: number
  recent: OperationRow[]
}

export type CustomerRow = {
  id: number
  nickname: string
  cardCode: string | null
  inviteCode: string
  invitedBy: number | null
  cashbackBalance: number
  createdAt: number
  paidTotal: number
  freeUsed: number
  cups: number
  referrals: number
}

export type EvotorLink = { storeUuid: string; evotorUuid: string | null; enabled?: number; lastError?: string | null; lastPushedAt?: number | null }
export type Product = {
  id: number
  name: string
  price: number
  icon: string
  available: number
  description: string | null
  categoryId: number | null
  categoryName: string | null
  imageUrl: string | null
  sortOrder: number
  updatedAt: number | null
  modifierSchemeId: number | null
  recipeText: string | null
  recipeCostRub: number | null
  recipeSeconds: number | null
  countsAsCup: number
  freeEligible: number
  tax: string | null
  measure: string | null
  costPriceKopecks: number | null
  seasonStartAt: number | null
  seasonEndAt: number | null
  evotorExtraJson: string | null
  catalogSource: string | null
  evotorLinks: EvotorLink[]
}
export type Category = { id: number; name: string; sortOrder: number; available: number }
export type Modifier = { id: number; name: string; price: number; groupKey: string; available: number; sortOrder: number }
export type Scheme = { id: number; name: string; items: { schemeId: number; modifierId: number; required?: number; maxCount?: number }[] }
export type EvotorStore = { uuid: string; name: string | null; address?: string | null; code?: string | null; syncEnabled: boolean }
export type Promo = { id: number; title: string; body: string; icon: string; sponsor: string | null; starts_at: number; ends_at: number }
export type VoucherTemplate = { id: number; code: string; title: string; kind: string; value: number; validDays: number }
export type AuditEntry = {
  id: number; at: number; actor: string; method: string; path: string; status: number; ok: number
  entity: string | null; entityId: string | null; summary: string | null; before: string | null; after: string | null; ip: string | null
}
export type BulkPlan = { dryRun: boolean; products: number; changedProducts: number; plan: { id: number; name: string; changes: { field: string; from: unknown; to: unknown }[] }[] }
