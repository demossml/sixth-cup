export type Voucher = [id: number, kind: 'p' | 'f', value: number, expDay: number]

export type CardState = {
  q: number; p: number; f: number; v: Voucher[]; cb: number
}
export type CardProof = CardState & { id: string; t: 'c'; ver: 2; kid: string; i: number; exp: number }
export type ReceiptPayload = CardState & {
  t: 'r'; r: string; u: number; d: number
  dp: number; df: number; dcb: number; vu: number[]; a: number; ts: number
}

export type Directory = {
  serverPub: string
  serverKeys?: { kid: string; pub: string }[]
  cupsForFree: number
  referralCashbackPercent: number
  currency: string
  generatedAt: number
  devices: { id: number; pub: string; revoked: boolean }[]
  stores: { id: number; name: string; address: string; organizationId?: number | null }[]
  organizations?: {
    id: number; name: string; legalName: string; taxRegime: string; vatRate: number
  }[]
  categories?: { id: number; name: string; sortOrder: number }[]
  products: {
    id: number; name: string; price: number; icon: string
    description?: string | null
    categoryId?: number | null
    imageUrl?: string | null
    sortOrder?: number
    freeEligible?: boolean
  }[]
  promos: { id: number; title: string; body: string; icon: string; sponsor: string | null; endsAt: number }[]
}

export type Me = {
  id: number; cardId: string; cardCode: string; nickname: string; inviteCode: string; cashbackBalance: number
  /** Серверное состояние лояльности (источник истины — backend). */
  cupsTowardFree?: number; freeAvailable?: number; cupsForFree?: number
  fromFriendsRub?: number; friendsCount?: number
  vouchers?: Voucher[]
}
export type StoredReceipt = { id: string; token: string; uploaded: 0 | 1; userId: number; q: number }
