/**
 * Sync one 6.7 product to enabled Evotor stores: CREATE once, then UPDATE / disable.
 */
import type Database from 'better-sqlite3'
import { EvotorClient } from '../client/EvotorClient'
import { randomUUID } from 'node:crypto'

type Link = {
  store_uuid: string
  evotor_uuid: string | null
  enabled: number
}

type Product = {
  id: number
  name: string
  price: number
  available: number
  tax: string | null
  measure: string | null
  cost_price_kopecks: number | null
  recipe_text: string | null
}

function bodyFromProduct(p: Product, allowToSell: boolean, existingUuid?: string | null): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: p.name,
    group: false,
    type: 'NORMAL',
    quantity: 9999,
    measureName: p.measure || 'шт',
    tax: p.tax || 'NO_VAT',
    allowToSell,
    price: Math.round(Number(p.price) * 100) / 100,
    costPrice: Math.round(Number(p.cost_price_kopecks || 0)) / 100,
    description: p.recipe_text || '',
    articleNumber: `sc-${p.id}`,
  }
  if (existingUuid) row.uuid = existingUuid
  else row.uuid = randomUUID()
  return row
}

export class AssignmentSync {
  constructor(
    private readonly db: Database.Database,
    private readonly client = new EvotorClient(),
  ) {}

  async syncProductAssignments(productId: number): Promise<{
    productId: number
    results: { storeUuid: string; action: string; evotorUuid?: string; error?: string }[]
  }> {
    if (!this.client.isConfigured) {
      return { productId, results: [{ storeUuid: '*', action: 'skip', error: 'EVOTOR_API_TOKEN not set' }] }
    }
    const p = this.db.prepare(`SELECT id, name, price, available, tax, measure, cost_price_kopecks, recipe_text FROM products WHERE id=?`).get(productId) as Product | undefined
    if (!p) return { productId, results: [{ storeUuid: '*', action: 'skip', error: 'product not found' }] }

    const links = this.db
      .prepare(`SELECT store_uuid, evotor_uuid, COALESCE(enabled,1) AS enabled FROM product_store_links WHERE product_id=?`)
      .all(productId) as Link[]

    const results: { storeUuid: string; action: string; evotorUuid?: string; error?: string }[] = []
    const now = Date.now()
    const upd = this.db.prepare(`
      UPDATE product_store_links
      SET evotor_uuid=COALESCE(?, evotor_uuid), last_pushed_at=?, last_error=?, allow_to_sell_remote=?, updated_at=?
      WHERE product_id=? AND store_uuid=?
    `)

    for (const link of links) {
      const allow = link.enabled === 1 && p.available === 1
      try {
        if (link.enabled === 0 && !link.evotor_uuid) {
          results.push({ storeUuid: link.store_uuid, action: 'skip_disabled' })
          continue
        }
        if (link.enabled === 0 && link.evotor_uuid) {
          const payload = [bodyFromProduct(p, false, link.evotor_uuid)]
          await this.client.postProducts(link.store_uuid, payload)
          upd.run(link.evotor_uuid, now, null, 0, now, productId, link.store_uuid)
          results.push({ storeUuid: link.store_uuid, action: 'disable', evotorUuid: link.evotor_uuid })
          continue
        }
        // enabled
        if (link.evotor_uuid) {
          await this.client.postProducts(link.store_uuid, [bodyFromProduct(p, allow, link.evotor_uuid)])
          upd.run(link.evotor_uuid, now, null, allow ? 1 : 0, now, productId, link.store_uuid)
          results.push({ storeUuid: link.store_uuid, action: 'update', evotorUuid: link.evotor_uuid })
        } else {
          const uuid = randomUUID()
          await this.client.postProducts(link.store_uuid, [bodyFromProduct(p, allow, uuid)])
          upd.run(uuid, now, null, allow ? 1 : 0, now, productId, link.store_uuid)
          results.push({ storeUuid: link.store_uuid, action: 'create', evotorUuid: uuid })
        }
      } catch (e) {
        const msg = String(e).slice(0, 500)
        upd.run(link.evotor_uuid, now, msg, link.enabled, now, productId, link.store_uuid)
        results.push({ storeUuid: link.store_uuid, action: 'error', error: msg })
      }
    }
    return { productId, results }
  }
}
