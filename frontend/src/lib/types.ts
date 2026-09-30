export type Voucher = [id: number, kind: 'p' | 'f', value: number, expDay: number]

export type CardState = {
  u: number; q: number; p: number; f: number; v: Voucher[]; cb: number
}
export type CardProof = CardState & { t: 'c'; i: number }
export type ReceiptPayload = CardState & {
  t: 'r'; r: string; d: number
  dp: number; df: number; dcb: number; vu: number[]; a: number; ts: number
}

export type Directory = {
  serverPub: string
  cupsForFree: number
  referralCashbackPercent: number
  currency: string
  generatedAt: number
  devices: { id: number; pub: string; revoked: boolean }[]
  stores: { id: number; name: string; address: string }[]
  products: { id: number; name: string; price: number; icon: string }[]
  promos: { id: number; title: string; body: string; icon: string; sponsor: string | null; endsAt: number }[]
}

export type Me = { id: number; nickname: string; inviteCode: string; cashbackBalance: number }
export type StoredReceipt = { id: string; token: string; uploaded: 0 | 1; userId: number; q: number }
