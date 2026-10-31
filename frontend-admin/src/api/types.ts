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
  /** Прайс удалён вручную: фон не выгружает товары (чеки опрашиваются). */
  catalogPaused?: boolean
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

export type DashboardException = { id: string; level: string; title: string; href: string; count: number }
export type Dashboard = {
  now: number
  period: '24h' | '7d' | '30d' | 'yesterday'
  health: Health
  docs: { sell: number; sellFailed: number; payback: number; paybackFailed: number }
  ops: { sells: number; paybacks: number; cups: number; cupsReturned: number; free: number; cashbackKopecks: number; resultRub: number; lastOpAt: number | null }
  sellWithoutCard: number
  customers: number
  newCustomers: number
  recent: OperationRow[]
  exceptions: DashboardException[]
  quality: { noPhoto: number; noCategory: number; noLink: number }
  coverage: { source: string; note: string; complete: boolean }
  failedDocs: number
  pendingOutbox: number
  asOf: number
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
  /** Схема молока — отдельное назначение (null = без схемы). */
  milkSchemeId?: number | null
  recipeText: string | null
  recipeCostRub: number | null
  recipeSeconds: number | null
  countsAsCup: number
  freeEligible: number
  sizeValue: number | null
  sizeUnit: 'g' | 'ml' | null
  calories: number | null
  tax: string | null
  measure: string | null
  costPriceKopecks: number | null
  seasonStartAt: number | null
  seasonEndAt: number | null
  evotorExtraJson: string | null
  catalogSource: string | null
  evotorLinks: EvotorLink[]
  /** Размеры: id витринной карточки и метка варианта («200 мл»). null — обычный одиночный товар. */
  groupId: number | null
  variantLabel: string | null
  variantSort: number
}
/** Витринная карточка с размерами: одна в админке → несколько SKU в кассе. */
export type ProductGroup = {
  id: number
  name: string
  imageUrl: string | null
  categoryId: number | null
  description: string | null
  modifierSchemeId: number | null
  countsAsCup: number | null
  freeEligible: number | null
  sortOrder: number
  variants: {
    id: number
    label: string | null
    variantSort: number
    name: string
    price: number
    available: number
    sizeValue: number | null
    sizeUnit: 'g' | 'ml' | null
    calories: number | null
    evotorUuid: string | null
  }[]
}
export type Category = { id: number; name: string; sortOrder: number; available: number }
export type Modifier = { id: number; name: string; price: number; groupKey: string; available: number; sortOrder: number; linkedProductId?: number | null }
export type SchemeItem = {
  id?: number
  schemeId?: number
  modifierId?: number | null
  productId?: number | null
  groupKey?: string | null
  required?: boolean | number
  maxCount?: number
  isDefault?: boolean
  zeroOption?: boolean
  priceOverride?: number | null
  nameOverride?: string | null
  sortOrder?: number
}
export type SchemeOption = {
  id?: number
  schemeId?: number
  kind: 'product' | 'zero' | 'modifier'
  productId?: number | null
  modifierId?: number | null
  name?: string | null
  groupKey?: string
  isDefault?: boolean
  required?: boolean
  maxCount?: number
  priceOverride?: number | null
  sortOrder?: number
}
export type Scheme = { id: number; name: string; copyFromId?: number; items: SchemeItem[]; options?: SchemeOption[] }
export type EvotorStore = {
  uuid: string
  id?: string | number
  storeUuid?: string
  name: string | null
  address?: string | null
  code?: string | null
  syncEnabled?: boolean
  sync_enabled?: number
}
export type Promo = { id: number; title: string; body: string; icon: string; sponsor: string | null; starts_at: number; ends_at: number }
export type VoucherTemplate = {
  id: number; code: string; title: string; kind: string; value: number; validDays: number
  active?: boolean; imageUrl?: string | null
  redemptionMode?: 'once' | 'multi'; maxPerDay?: number | null; maxTotal?: number | null
  stackableWithFreeCup?: boolean
}
export type AuditEntry = {
  id: number; at: number; actor: string; method: string; path: string; status: number; ok: number
  entity: string | null; entityId: string | null; summary: string | null; before: string | null; after: string | null; ip: string | null
}
export type BulkPlan = { dryRun: boolean; products: number; changedProducts: number; plan: { id: number; name: string; changes: { field: string; from: unknown; to: unknown }[] }[] }

export type MilkVariant = {
  id: number
  productId: number | null
  label: string
  isDefault: boolean
  isFree: boolean
  sendToReceipt: boolean
  sortOrder: number
  active: boolean
}
export type MilkScheme = {
  id: number
  name: string
  active: boolean
  variants: MilkVariant[]
  usedByProducts: number
  createdAt: number
  updatedAt: number
}
