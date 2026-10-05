/**
 * Push products from our SQLite → Evotor Cloud (v1 POST products).
 * After success, terminal must load nomenclature from cloud (or auto-sync).
 */
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { EvotorClient } from '../client/EvotorClient'

export type LocalProduct = {
  id: number
  name: string
  price: number // kopecks
  available: number
  evotor_uuid: string | null
  tax: string | null
  measure: string | null
}

/** Map local kopecks + fields → Evotor v1 product body */
export function toEvotorProduct(p: LocalProduct, storeUuid: string): Record<string, unknown> {
  const uuid = p.evotor_uuid || randomUUID()
  return {
    uuid,
    name: p.name,
    group: false,
    type: 'NORMAL',
    quantity: 9999,
    measureName: p.measure || 'шт',
    tax: p.tax || 'NO_VAT',
    allowToSell: p.available === 1,
    price: Math.round(p.price) / 100, // rubles
    costPrice: 0,
    description: '',
    articleNumber: `sc-${p.id}`,
    // storeUuid not always required in body for v1 POST path
  }
}

export class ProductPushService {
  constructor(
    private readonly db: Database.Database,
    private readonly client = new EvotorClient(),
  ) {}

  /** Ensure columns exist (idempotent) */
  ensureSchema() {
    const cols = this.db.prepare(`PRAGMA table_info(products)`).all() as { name: string }[]
    const names = new Set(cols.map((c) => c.name))
    if (!names.has('evotor_uuid')) {
      this.db.exec(`ALTER TABLE products ADD COLUMN evotor_uuid TEXT`)
    }
    if (!names.has('tax')) {
      this.db.exec(`ALTER TABLE products ADD COLUMN tax TEXT DEFAULT 'NO_VAT'`)
    }
    if (!names.has('measure')) {
      this.db.exec(`ALTER TABLE products ADD COLUMN measure TEXT DEFAULT 'шт'`)
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS product_store_links (
        product_id INTEGER NOT NULL,
        store_uuid TEXT NOT NULL,
        evotor_uuid TEXT,
        last_pushed_at INTEGER,
        last_error TEXT,
        PRIMARY KEY (product_id, store_uuid)
      )
    `)
  }

  listLocal(): LocalProduct[] {
    return this.db
      .prepare(
        `SELECT id, name, price, available,
                COALESCE(evotor_uuid, NULL) AS evotor_uuid,
                COALESCE(tax, 'NO_VAT') AS tax,
                COALESCE(measure, 'шт') AS measure
         FROM products ORDER BY id`,
      )
      .all() as LocalProduct[]
  }

  /**
   * Push all available products to one Evotor store.
   * Saves evotor_uuid on products + product_store_links.
   */
  async pushToStore(storeUuid: string): Promise<{ pushed: number; errors: string[] }> {
    this.ensureSchema()
    if (!this.client.isConfigured) {
      return { pushed: 0, errors: ['EVOTOR_API_TOKEN not set'] }
    }
    const products = this.listLocal().filter((p) => p.available === 1)
    if (products.length === 0) return { pushed: 0, errors: ['no available products'] }

    const body: Record<string, unknown>[] = []
    const uuidById = new Map<number, string>()
    for (const p of products) {
      const row = toEvotorProduct(p, storeUuid)
      uuidById.set(p.id, row.uuid as string)
      body.push(row)
    }

    const errors: string[] = []
    try {
      await this.client.postProducts(storeUuid, body)
    } catch (e) {
      return { pushed: 0, errors: [String(e)] }
    }

    const now = Date.now()
    const upd = this.db.prepare(`UPDATE products SET evotor_uuid = COALESCE(evotor_uuid, ?) WHERE id = ?`)
    const link = this.db.prepare(`
      INSERT INTO product_store_links(product_id, store_uuid, evotor_uuid, last_pushed_at, last_error)
      VALUES (?,?,?,?,NULL)
      ON CONFLICT(product_id, store_uuid) DO UPDATE SET
        evotor_uuid=excluded.evotor_uuid, last_pushed_at=excluded.last_pushed_at, last_error=NULL
    `)
    this.db.transaction(() => {
      for (const p of products) {
        const u = uuidById.get(p.id)!
        if (!p.evotor_uuid) upd.run(u, p.id)
        link.run(p.id, storeUuid, u, now)
      }
    })()

    return { pushed: products.length, errors }
  }

  async pullFromStore(storeUuid: string): Promise<{ count: number }> {
    this.ensureSchema()
    const raw = await this.client.getProducts(storeUuid)
    const list = Array.isArray(raw) ? raw : []
    return { count: list.length }
  }
}
