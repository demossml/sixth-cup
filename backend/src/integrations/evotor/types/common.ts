/** Document type union — official Cloud API set (MASTER-TZ §5). */
export type EvotorDocumentType =
  | 'OPEN_SESSION'
  | 'POS_OPEN_SESSION'
  | 'CLOSE_SESSION'
  | 'CASH_INCOME'
  | 'CASH_OUTCOME'
  | 'INVENTORY'
  | 'ACCEPT'
  | 'REVALUATION'
  | 'WRITE_OFF'
  | 'RETURN'
  | 'OPEN_TARE'
  | 'SELL'
  | 'PAYBACK'
  | 'BUY'
  | 'BUYBACK'
  | 'X_REPORT'
  | 'Z_REPORT'
  | 'CORRECTION'

export type EvotorDocStatus =
  | 'RECEIVED'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'IGNORED'
  | 'FAILED'

export interface EvotorPaging {
  next_cursor?: string
}

export interface EvotorDocumentBase {
  type: EvotorDocumentType | string
  id: string
  store_id?: string
  device_id?: string
  session_id?: string
  number?: number
  close_date?: string
  version?: string
  extras?: Record<string, unknown>
  body?: unknown
  /** Some payloads use different casings — keep passthrough via unknown fields in parse */
  [key: string]: unknown
}

/** Loyalty payload written by APK into receipt extras (MASTER-TZ §6.3). */
export interface ScReceiptExtra {
  v: number
  kid: string
  c: string
  q: number
  op: string
  free?: number
  cb?: number
  vc?: string
  disc?: string
  ts?: number
}
