import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { EvotorClient } from '../client/EvotorClient'
import { evotorConfig } from '../../../config'

const UUID_NS = '151071e8-88a4-44f6-b71a-b17c559f9b7d'

function uuidBytes(value: string): Buffer {
  const hex = value.replace(/-/g, '')
  return Buffer.from(hex, 'hex')
}

/** RFC 4122 UUIDv5, deterministic for the same namespace/name. */
export function uuidv5(name: string, namespace = UUID_NS): string {
  const digest = createHash('sha1').update(Buffer.concat([uuidBytes(namespace), Buffer.from(name, 'utf8')])).digest()
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  const h = digest.toString('hex').slice(0, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export type LocalProduct = {
  id: number
  name: string
  price: number
  available: number
  counts_as_cup: number
  evotor_uuid: string | null
  tax: string | null
  measure: string | null
  cost_price_kopecks: number
  free_eligible: number
  season_start_at: number | null
  season_end_at: number | null
  evotor_extra_json: string | null
}

function activeBySeason(p: LocalProduct, now = Date.now()): boolean {
  return (p.season_start_at == null || p.season_start_at <= now) && (p.season_end_at == null || p.season_end_at >= now)
}

export function toEvotorProduct(p: LocalProduct, storeUuid: string): Record<string, unknown> {
  const uuid = uuidv5(`${storeUuid}:${p.id}`)
  return {
    uuid,
    name: p.name,
    group: false,
    type: 'NORMAL',
    quantity: 9999,
    measureName: p.measure || 'шт',
    tax: p.tax || 'NO_VAT',
    allowToSell: p.available === 1 && activeBySeason(p),
    price: Math.round(p.price) / 100,
    costPrice: Math.round(p.cost_price_kopecks) / 100,
    description: '',
    articleNumber: `sc-${p.id}`,
  }
}

export class ProductPushService {
  constructor(
    private readonly db: Database.Database,
    private readonly client = new EvotorClient(),
  ) {}

  ensureSchema() {
    const cols = this.db.prepare(`PRAGMA table_info(products)`).all() as { name: string }[]
    const names = new Set(cols.map((c) => c.name))
    if (!names.has('evotor_uuid')) this.db.exec(`ALTER TABLE products ADD COLUMN evotor_uuid TEXT`)
    if (!names.has('tax')) this.db.exec(`ALTER TABLE products ADD COLUMN tax TEXT DEFAULT 'NO_VAT'`)
    if (!names.has('measure')) this.db.exec(`ALTER TABLE products ADD COLUMN measure TEXT DEFAULT 'шт'`)
    if (!names.has('cost_price_kopecks')) this.db.exec(`ALTER TABLE products ADD COLUMN cost_price_kopecks INTEGER NOT NULL DEFAULT 0`)
    if (!names.has('free_eligible')) this.db.exec(`ALTER TABLE products ADD COLUMN free_eligible INTEGER NOT NULL DEFAULT 0`)
    if (!names.has('season_start_at')) this.db.exec(`ALTER TABLE products ADD COLUMN season_start_at INTEGER`)
    if (!names.has('season_end_at')) this.db.exec(`ALTER TABLE products ADD COLUMN season_end_at INTEGER`)
    if (!names.has('evotor_extra_json')) this.db.exec(`ALTER TABLE products ADD COLUMN evotor_extra_json TEXT`)
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
    return this.db.prepare(`
      SELECT id,name,price,available,counts_as_cup,
             evotor_uuid,tax,measure,cost_price_kopecks,free_eligible,
             season_start_at,season_end_at,evotor_extra_json
      FROM products ORDER BY id
    `).all() as LocalProduct[]
  }

  private enqueue(storeUuid: string, product: LocalProduct, payload: Record<string, unknown>) {
    const entityKey = String(product.id)
    const payloadHash = hashPayload(payload)
    const existing = this.db.prepare(`SELECT id FROM evotor_outbox WHERE store_uuid=? AND entity='PRODUCT' AND entity_key=? AND status='PENDING' LIMIT 1`)
      .get(storeUuid, entityKey) as { id: number } | undefined
    if (existing) {
      this.db.prepare(`UPDATE evotor_outbox SET payload_hash=?,next_at=?,last_error=NULL WHERE id=?`)
        .run(payloadHash, Date.now(), existing.id)
    } else {
      this.db.prepare(`INSERT INTO evotor_outbox(store_uuid,entity,entity_key,op,payload_hash,priority,status,attempts,next_at)
        VALUES(?,?,?,?,?,?, 'PENDING',0,?)`).run(storeUuid, 'PRODUCT', entityKey, 'UPSERT', payloadHash, 5, Date.now())
    }
  }

  private async pushExtras(storeUuid: string, product: LocalProduct, productUuid: string): Promise<void> {
    if (!evotorConfig.appId || !product.evotor_extra_json) return
    let data: unknown
    try { data = JSON.parse(product.evotor_extra_json) } catch { throw new Error(`Invalid evotor_extra_json for product ${product.id}`) }
    await this.client.postProductExtras(storeUuid, [{
      uuid: uuidv5(`${storeUuid}:extra:${product.id}`),
      appId: evotorConfig.appId,
      key: { uuid: productUuid },
      data,
      name: 'sixthcup',
    }])
  }

  async pushToStore(storeUuid: string): Promise<{ pushed: number; errors: string[] }> {
    this.ensureSchema()
    if (!this.client.isConfigured) return { pushed: 0, errors: ['EVOTOR_API_TOKEN not set'] }
    const products = this.listLocal()
    if (!products.length) return { pushed: 0, errors: ['no products'] }

    for (const p of products) this.enqueue(storeUuid, p, toEvotorProduct(p, storeUuid))
    const ready = this.db.prepare(`SELECT * FROM evotor_outbox WHERE store_uuid=? AND entity='PRODUCT' AND status='PENDING' AND next_at<=? ORDER BY priority,id LIMIT 200`)
      .all(storeUuid, Date.now()) as { id: number; entity_key: string; attempts: number }[]
    const byId = new Map(products.map((p) => [p.id, p]))
    let pushed = 0
    const errors: string[] = []

    for (const item of ready) {
      const p = byId.get(Number(item.entity_key))
      if (!p) continue
      const payload = toEvotorProduct(p, storeUuid)
      try {
        await this.client.postProducts(storeUuid, [payload])
        await this.pushExtras(storeUuid, p, String(payload.uuid))
        const now = Date.now()
        this.db.transaction(() => {
          this.db.prepare(`UPDATE evotor_outbox SET status='DONE',attempts=attempts+1,last_error=NULL,next_at=? WHERE id=?`).run(now, item.id)
          this.db.prepare(`INSERT INTO evotor_products(product_id,variant,store_uuid,evotor_uuid,last_hash,last_synced_at,status,last_error)
            VALUES(?,?,?,?,?,?,?,NULL)
            ON CONFLICT(product_id,variant,store_uuid) DO UPDATE SET evotor_uuid=excluded.evotor_uuid,last_hash=excluded.last_hash,last_synced_at=excluded.last_synced_at,status='SYNCED',last_error=NULL`)
            .run(p.id, '', storeUuid, String(payload.uuid), hashPayload(payload), now, 'SYNCED')
          this.db.prepare(`INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid,last_pushed_at,last_error)
            VALUES(?,?,?,?,NULL) ON CONFLICT(product_id,store_uuid) DO UPDATE SET evotor_uuid=excluded.evotor_uuid,last_pushed_at=excluded.last_pushed_at,last_error=NULL`)
            .run(p.id, storeUuid, String(payload.uuid), now)
        })()
        pushed++
      } catch (e) {
        const attempts = item.attempts + 1
        const nextAt = Date.now() + Math.min(3_600_000, 5_000 * 2 ** Math.min(attempts, 8))
        this.db.prepare(`UPDATE evotor_outbox SET attempts=?,next_at=?,last_error=? WHERE id=?`).run(attempts, nextAt, String(e), item.id)
        this.db.prepare(`INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid,last_pushed_at,last_error)
          VALUES(?,?,?,?,?) ON CONFLICT(product_id,store_uuid) DO UPDATE SET last_error=excluded.last_error`).run(p.id, storeUuid, String(payload.uuid), null, String(e))
        errors.push(`${p.id}: ${String(e)}`)
      }
    }
    return { pushed, errors }
  }

  async verifyStore(storeUuid: string): Promise<{ drift: { productId: number; expected: string; actual?: string }[]; count: number }> {
    this.ensureSchema()
    const raw = await this.client.getProducts(storeUuid)
    const items = Array.isArray(raw) ? raw as Record<string, unknown>[] : []
    const actual = new Map(items.map((x) => [String(x.uuid ?? x.id ?? ''), x]))
    const drift: { productId: number; expected: string; actual?: string }[] = []
    for (const p of this.listLocal()) {
      const expected = String(toEvotorProduct(p, storeUuid).uuid)
      if (!actual.has(expected)) drift.push({ productId: p.id, expected })
    }
    return { drift, count: items.length }
  }
}
