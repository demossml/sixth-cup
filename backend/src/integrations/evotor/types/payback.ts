import type { EvotorSellBody } from './sell'

export interface EvotorPaybackBody extends EvotorSellBody {
  base_document_id?: string
  base_document_number?: number
}
