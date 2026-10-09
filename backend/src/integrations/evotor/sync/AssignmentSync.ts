/** @deprecated Compatibility adapter. All outbound catalog writes belong to ProductPushService. */
import type Database from 'better-sqlite3'
import { EvotorClient } from '../client/EvotorClient'
import { ProductPushService } from './ProductPushService'

export class AssignmentSync {
  constructor(private readonly db: Database.Database, private readonly client = new EvotorClient()) {}

  async syncProductAssignments(productId: number): Promise<{
    productId: number
    results: { storeUuid: string; action: string; evotorUuid?: string; error?: string; pushed?: number; extrasFailed?: number }[]
  }> {
    const exists = this.db.prepare(`SELECT id FROM products WHERE id=?`).get(productId) as { id: number } | undefined
    if (!exists) return { productId, results: [{ storeUuid: '*', action: 'skip', error: 'product not found' }] }
    if (!this.client.isConfigured) return { productId, results: [{ storeUuid: '*', action: 'skip', error: 'EVOTOR_API_TOKEN not set' }] }

    const stores = this.db.prepare(`SELECT store_uuid FROM evotor_stores WHERE COALESCE(sync_enabled,0)=1`).all() as { store_uuid: string }[]
    const catalog = new ProductPushService(this.db, this.client)
    const results = []
    for (const store of stores) {
      const result = await catalog.pushToStore(store.store_uuid)
      results.push({
        storeUuid: store.store_uuid,
        action: result.errors.length ? 'error' : 'catalog_reconciled',
        pushed: result.pushed,
        extrasFailed: result.extrasFailed,
        error: result.errors.slice(0, 3).join('; ') || undefined,
      })
    }
    return { productId, results }
  }
}
