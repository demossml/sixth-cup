/**
 * SELL body — minimal fields used by loyalty.
 * Full schema MUST be refined from __fixtures__ after Phase 0 (MASTER-TZ §5.3).
 */
export interface EvotorSellPosition {
  product_id?: string
  quantity?: number
  price?: number
  sum?: number
  result_price?: number
  result_sum?: number
  doc_distributed_discount?: { discount_sum?: number }
  [key: string]: unknown
}

export interface EvotorDocDiscount {
  discount_type?: string
  discount_sum?: number
  discount_percent?: number
  coupon?: string
  [key: string]: unknown
}

export interface EvotorSellBody {
  positions?: EvotorSellPosition[]
  payments?: unknown[]
  doc_discounts?: EvotorDocDiscount[]
  sum?: number
  result_sum?: number
  [key: string]: unknown
}
