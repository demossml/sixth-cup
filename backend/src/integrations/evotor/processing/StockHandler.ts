/**
 * Склад для документов Эвотора. Единственная точка входа склада на чеке:
 * вызывается из `PollService` после лояльности, поэтому сырьё списывается
 * и на чеках без карты (Q-01), а ошибки склада не откатывают лояльность (D-04).
 */
import type Database from 'better-sqlite3'
import { sellInternals as s } from './SellHandler'
import { writeOffSellByNorms, type WriteOffResult } from '../../../modules/admin/stockWriteOff'

export type StockApplyResult =
  | ({ kind: 'sell' } & WriteOffResult)
  | { kind: 'skipped'; reason: string }

export function applyStockForDocument(
  db: Database.Database,
  storeUuid: string,
  doc: Record<string, unknown>,
): StockApplyResult {
  const type = String(doc.type ?? '')
  const docId = s.documentIdOf(doc)
  if (!docId) return { kind: 'skipped', reason: 'no_doc_id' }

  const positions = s
    .transactions(doc)
    .map((tx) => ({ productUuid: s.productUuid(tx), qty: s.qty(tx) }))
    .filter((p) => p.productUuid && p.qty > 0)

  if (type === 'SELL') {
    return { kind: 'sell', ...writeOffSellByNorms(db, storeUuid, docId, positions) }
  }
  return { kind: 'skipped', reason: `type_${type}` }
}
