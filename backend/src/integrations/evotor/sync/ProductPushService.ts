import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { EvotorClient } from '../client/EvotorClient'
import { evotorConfig } from '../../../config'
import { log, shortId } from '../../../lib/logBuffer'

const UUID_NS = '151071e8-88a4-44f6-b71a-b17c559f9b7d'

function uuidBytes(value: string): Buffer {
  const hex = value.replace(/-/g, '')
  return Buffer.from(hex, 'hex')
}

/** RFC 4122 UUIDv5. Used only for our own ProductExtra UUID; never as Evotor product id. */
export function uuidv5(name: string, namespace = UUID_NS): string {
  const digest = createHash('sha1').update(Buffer.concat([uuidBytes(namespace), Buffer.from(name, 'utf8')])).digest()
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  const h = digest.toString('hex').slice(0, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}


export function outboxRetryDelay(attempts: number): number {
  const delays = [60_000, 120_000, 300_000, 900_000, 3_600_000]
  return delays[Math.min(Math.max(0, attempts - 1), delays.length - 1)]
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
  modifier_scheme_id: number | null
  recipe_text: string | null
  recipe_cost_rub: number | null
  recipe_seconds: number | null
  catalog_source: 'SIXTH_CUP' | 'EVOTOR_IMPORT'
}

function activeBySeason(p: LocalProduct, now = Date.now()): boolean {
  return (p.season_start_at == null || p.season_start_at <= now) && (p.season_end_at == null || p.season_end_at >= now)
}

/**
 * Product body deliberately has NO Evotor UUID. The Cloud creates it on POST.
 * The returned Cloud id is stored in product_store_links and is used for PUT thereafter.
 */
export function toEvotorProduct(p: LocalProduct, _storeUuid: string): Record<string, unknown> {
  return {
    name: p.name,
    type: 'NORMAL',
    measure_name: p.measure || 'шт',
    tax: p.tax || 'NO_VAT',
    allow_to_sell: p.available === 1 && activeBySeason(p),
    // products.price in 6.7 is stored in RUB; Evotor Cloud expects number<float> in RUB.
    price: Math.round(Number(p.price) * 100) / 100,
    cost_price: Math.round(Number(p.cost_price_kopecks)) / 100,
    description: p.recipe_text || '',
    article_number: `sc-${p.id}`,
  }
}

function remoteId(item: Record<string, unknown>): string | null {
  const value = item.id ?? item.uuid ?? item.productUuid ?? item.product_id
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function remoteArticleNumber(item: Record<string, unknown>): string | null {
  const value = item.articleNumber ?? item.article_number ?? item.article
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function remoteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    for (const key of ['items', 'products', 'data']) {
      if (Array.isArray(o[key])) return o[key].filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    }
  }
  return []
}

function parseCreatedProductId(response: unknown): string | null {
  if (response && typeof response === 'object') {
    const o = response as Record<string, unknown>
    const direct = remoteId(o)
    if (direct) return direct
    for (const key of ['product', 'item', 'data']) {
      const nested = o[key]
      if (nested && typeof nested === 'object') {
        const id = remoteId(nested as Record<string, unknown>)
        if (id) return id
      }
    }
  }
  const first = asArray(response)[0]
  return first ? remoteId(first) : null
}

function parseCustomJson(value: string | null | undefined): unknown {
  if (!value?.trim()) return null
  try { return JSON.parse(value) } catch { return null }
}

export class ProductPushService {
  private static readonly runningStores = new Set<string>()

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
    if (!names.has('catalog_source')) this.db.exec(`ALTER TABLE products ADD COLUMN catalog_source TEXT NOT NULL DEFAULT 'SIXTH_CUP'`)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS product_store_links (
        product_id INTEGER NOT NULL,
        store_uuid TEXT NOT NULL,
        evotor_uuid TEXT,
        last_pushed_at INTEGER,
        last_error TEXT,
        PRIMARY KEY (product_id, store_uuid)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_product_store_links_store_evotor
        ON product_store_links(store_uuid, evotor_uuid) WHERE evotor_uuid IS NOT NULL;
    `)
  }

  listLocal(includeImported = true): LocalProduct[] {
    const rows = this.db.prepare(`
      SELECT id,name,price,available,counts_as_cup,
             evotor_uuid,tax,measure,cost_price_kopecks,free_eligible,
             season_start_at,season_end_at,evotor_extra_json,
             modifier_scheme_id,recipe_text,recipe_cost_rub,recipe_seconds,
             catalog_source
      FROM products
      ${includeImported ? '' : `WHERE catalog_source='SIXTH_CUP'`}
      ORDER BY id
    `).all() as LocalProduct[]
    return rows
  }

  private enqueue(storeUuid: string, product: LocalProduct): boolean {
    const payloadHash = this.syncHash(product)
    const entityKey = String(product.id)
    const last = this.db.prepare(`SELECT last_hash,status,evotor_uuid FROM evotor_products WHERE product_id=? AND variant='' AND store_uuid=?`)
      .get(product.id, storeUuid) as { last_hash: string | null; status: string; evotor_uuid: string } | undefined
    const pending = this.db.prepare(`SELECT id FROM evotor_outbox WHERE store_uuid=? AND entity='PRODUCT' AND entity_key=? AND status='PENDING' LIMIT 1`)
      .get(storeUuid, entityKey) as { id: number } | undefined
    const needsSync = !last?.evotor_uuid || last.status !== 'SYNCED' || last.last_hash !== payloadHash
    if (!needsSync && !pending) return false
    if (pending) {
      this.db.prepare(`UPDATE evotor_outbox SET payload_hash=?,last_error=NULL WHERE id=?`).run(payloadHash, pending.id)
      return true
    }
    this.db.prepare(`INSERT INTO evotor_outbox(store_uuid,entity,entity_key,op,payload_hash,priority,status,attempts,next_at)
      VALUES(?,?,?,?,?,?, 'PENDING',0,?)`).run(storeUuid, 'PRODUCT', entityKey, 'UPSERT', payloadHash, 5, Date.now())
    return true
  }

  private buildExtra(product: LocalProduct, productUuid: string): Record<string, unknown> | null {
    const modifiers = product.modifier_scheme_id == null ? [] : this.db.prepare(`
      SELECT m.id, m.name, m.price, m.group_key AS groupKey
      FROM modifier_scheme_items i
      JOIN modifiers m ON m.id=i.modifier_id
      WHERE i.scheme_id=? AND m.available=1
      ORDER BY m.sort_order, m.id
    `).all(product.modifier_scheme_id) as { id: number; name: string; price: number; groupKey: string }[]

    const custom = parseCustomJson(product.evotor_extra_json)
    const data: Record<string, unknown> = {
      schema: '6.7.product.v1',
      productUuid,
      countsAsCup: product.counts_as_cup === 1,
      freeEligible: product.free_eligible === 1,
      recipe: product.recipe_text,
      recipeCostRub: product.recipe_cost_rub,
      recipeSeconds: product.recipe_seconds,
      toppings: modifiers.map((m) => ({ id: m.id, name: m.name, priceRub: m.price, groupKey: m.groupKey })),
    }
    if (custom !== null) data.custom = custom
    return data
  }

  private syncHash(product: LocalProduct): string {
    const payload = toEvotorProduct(product, '')
    const extra = this.buildExtra(product, 'PENDING')
    return hashPayload({ payload, extra })
  }

  private async pushExtras(storeUuid: string, product: LocalProduct, productUuid: string): Promise<void> {
    if (!evotorConfig.pushExtras || !evotorConfig.appId) return
    const data = this.buildExtra(product, productUuid)
    if (!data) return
    await this.client.postProductExtras(storeUuid, [{
      uuid: uuidv5(`${storeUuid}:product-extra:${productUuid}`),
      appId: evotorConfig.appId,
      key: { uuid: productUuid },
      data,
      name: 'sixthcup',
    }])
  }

  private async remoteProducts(storeUuid: string): Promise<Record<string, unknown>[]> {
    return asArray(await this.client.getProducts(storeUuid))
  }

  private link(storeUuid: string, product: LocalProduct, evotorUuid: string, now = Date.now()) {
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid,last_pushed_at,last_error)
        VALUES(?,?,?,?,NULL)
        ON CONFLICT(product_id,store_uuid) DO UPDATE SET evotor_uuid=excluded.evotor_uuid,last_pushed_at=excluded.last_pushed_at,last_error=NULL`)
        .run(product.id, storeUuid, evotorUuid, now)
      this.db.prepare(`INSERT INTO evotor_products(product_id,variant,store_uuid,evotor_uuid,last_hash,last_synced_at,status,last_error,raw_json)
        VALUES(?,?,?,?,?,?,?,'',NULL)
        ON CONFLICT(product_id,variant,store_uuid) DO UPDATE SET evotor_uuid=excluded.evotor_uuid,last_synced_at=excluded.last_synced_at,status='SYNCED',last_error=NULL`)
        .run(product.id, '', storeUuid, evotorUuid, '', now, 'SYNCED')
      // products.evotor_uuid is legacy/deprecated; links are the sole source of store-specific IDs.
    })()
  }

  private async ensureRemoteId(storeUuid: string, product: LocalProduct, remote: Record<string, unknown>[]): Promise<string> {
    const saved = this.db.prepare(`SELECT evotor_uuid FROM product_store_links WHERE product_id=? AND store_uuid=? AND evotor_uuid IS NOT NULL`)
      .get(product.id, storeUuid) as { evotor_uuid: string } | undefined
    if (saved?.evotor_uuid) {
      if (remote.some((item) => remoteId(item) === saved.evotor_uuid)) return saved.evotor_uuid
      // Stale store-specific mapping: never PUT to a product that no longer exists.
      this.db.prepare(`UPDATE product_store_links SET evotor_uuid=NULL,last_error='Stale Evotor UUID; recreating' WHERE product_id=? AND store_uuid=?`).run(product.id, storeUuid)
    }

    // Legacy single-store mappings are safe only when the same UUID is present in this store's remote catalog.
    if (product.evotor_uuid && remote.some((item) => remoteId(item) === product.evotor_uuid)) {
      this.link(storeUuid, product, product.evotor_uuid)
      return product.evotor_uuid
    }

    const stableArticle = `sc-${product.id}`
    const articleMatches = remote.filter((item) => remoteArticleNumber(item) === stableArticle)
    if (articleMatches.length > 1) {
      throw new Error(`Ambiguous Evotor catalog: multiple products use articleNumber ${stableArticle}`)
    }
    const foundId = articleMatches[0] ? remoteId(articleMatches[0]) : null
    if (foundId) {
      this.link(storeUuid, product, foundId)
      return foundId
    }

    const response = await this.client.createCloudProduct(storeUuid, toEvotorProduct(product, storeUuid))
    const id = parseCreatedProductId(response)
    if (!id) throw new Error('Evotor Cloud CREATE returned no product id')
    this.link(storeUuid, product, id)
    return id
  }

  private remoteEquivalent(product: LocalProduct, remote: Record<string, unknown>): boolean {
    const allow = remote.allow_to_sell ?? remote.allowToSell
    const expectedAllow = product.available === 1 && activeBySeason(product)
    const remotePrice = remoteNumber(remote.price ?? remote.priceOut ?? remote.price_out)
    const remoteCost = remoteNumber(remote.cost_price ?? remote.costPrice)
    const priceOk = remotePrice == null || Math.abs(remotePrice - Number(product.price)) < 0.01
    const costOk = remoteCost == null || Math.abs(remoteCost - Number(product.cost_price_kopecks) / 100) < 0.01
    const nameOk = String(remote.name ?? '') === product.name
    const allowOk = allow == null || Boolean(allow) === expectedAllow
    const measure = String(remote.measure_name ?? remote.measureName ?? remote.measure ?? '')
    const measureOk = !product.measure || !measure || measure === product.measure
    const tax = String(remote.tax ?? '')
    const taxOk = !product.tax || !tax || tax === product.tax
    const description = String(remote.description ?? '')
    const descriptionOk = description === (product.recipe_text || '')
    return nameOk && priceOk && costOk && allowOk && measureOk && taxOk && descriptionOk
  }

  private async pushToStoreInternal(storeUuid: string): Promise<{ pushed: number; errors: string[]; linked: number; extrasFailed: number }> {
    this.ensureSchema()
    if (!this.client.isConfigured) return { pushed: 0, linked: 0, errors: ['[list] GET products status=0 EVOTOR_API_TOKEN not set'], extrasFailed: 0 }

    // Only products created/managed in 6.7 are outbound masters. Pure Evotor imports stay read-only.
    const products = this.listLocal(false)
    if (!products.length) return { pushed: 0, linked: 0, errors: [], extrasFailed: 0 }
    for (const p of products) this.enqueue(storeUuid, p)

    const ready = this.db.prepare(`SELECT id,entity_key,attempts FROM evotor_outbox
      WHERE store_uuid=? AND entity='PRODUCT' AND status='PENDING' AND next_at<=?
      ORDER BY priority,id LIMIT 200`).all(storeUuid, Date.now()) as { id: number; entity_key: string; attempts: number }[]
    if (!ready.length) return { pushed: 0, linked: 0, errors: [], extrasFailed: 0 }

    const remote = await this.remoteProducts(storeUuid)
    const byId = new Map(products.map((p) => [p.id, p]))
    let pushed = 0
    let linked = 0
    let extrasFailed = 0
    const errors: string[] = []

    for (const item of ready) {
      const p = byId.get(Number(item.entity_key))
      if (!p) continue
      try {
        const knownBefore = remote.some((r) => remoteId(r) === (this.db.prepare(`SELECT evotor_uuid FROM product_store_links WHERE product_id=? AND store_uuid=?`).get(p.id, storeUuid) as { evotor_uuid: string | null } | undefined)?.evotor_uuid)
        const productUuid = await this.ensureRemoteId(storeUuid, p, remote)
        const payload = toEvotorProduct(p, storeUuid)
        const existingRemote = remote.find((r) => remoteId(r) === productUuid)
        if (existingRemote || knownBefore) await this.client.replaceCloudProduct(storeUuid, productUuid, payload)
        try {
          await this.pushExtras(storeUuid, p, productUuid)
        } catch (extraError) {
          extrasFailed++
          const warning = `[extras] POST ${evotorConfig.apiBaseUrl}/api/v1/inventories/stores/${storeUuid}/products/extras: ${String(extraError).slice(0, 400)}`
          log.warn('evotor catalog extras failed', { store: shortId(storeUuid), productId: p.id, stage: 'extras', method: 'POST', path: `/api/v1/inventories/stores/${storeUuid}/products/extras`, error: warning })
          this.db.prepare(`UPDATE product_store_links SET last_error=? WHERE product_id=? AND store_uuid=?`).run(warning, p.id, storeUuid)
        }
        const now = Date.now()
        this.db.transaction(() => {
          this.db.prepare(`UPDATE evotor_outbox SET status='DONE',attempts=attempts+1,last_error=NULL,next_at=? WHERE id=?`).run(now, item.id)
          this.db.prepare(`INSERT INTO evotor_products(product_id,variant,store_uuid,evotor_uuid,last_hash,last_synced_at,status,last_error,raw_json)
            VALUES(?,'',?,?,?,?,? ,NULL,NULL)
            ON CONFLICT(product_id,variant,store_uuid) DO UPDATE SET evotor_uuid=excluded.evotor_uuid,last_hash=excluded.last_hash,last_synced_at=excluded.last_synced_at,status='SYNCED',last_error=NULL`)
            .run(p.id, storeUuid, productUuid, this.syncHash(p), now, 'SYNCED')
          this.db.prepare(`UPDATE product_store_links SET evotor_uuid=?,last_pushed_at=?,last_error=NULL WHERE product_id=? AND store_uuid=?`)
            .run(productUuid, now, p.id, storeUuid)
        })()
        pushed++
        if (!existingRemote) linked++
      } catch (e) {
        const attempts = item.attempts + 1
        const nextAt = Date.now() + outboxRetryDelay(attempts)
        const message = String(e).slice(0, 500)
        this.db.prepare(`UPDATE evotor_outbox SET attempts=?,next_at=?,last_error=? WHERE id=?`).run(attempts, nextAt, message, item.id)
        this.db.prepare(`INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid,last_pushed_at,last_error)
          VALUES(?,?,?,?,?) ON CONFLICT(product_id,store_uuid) DO UPDATE SET last_error=excluded.last_error`)
          .run(p.id, storeUuid, p.evotor_uuid, null, message)
        errors.push(`${p.id}: ${message}`)
      }
    }
    log[errors.length ? 'warn' : 'info']('evotor catalog push', { store: shortId(storeUuid), pushed, failed: errors.length, extrasFailed, sampleErrors: errors.slice(0, 5) })
    return { pushed, linked, errors, extrasFailed }
  }

  async pushToStore(storeUuid: string): Promise<{ pushed: number; errors: string[]; linked: number; extrasFailed: number }> {
    if (ProductPushService.runningStores.has(storeUuid)) {
      return { pushed: 0, linked: 0, errors: ['EVOTOR_SYNC_ALREADY_RUNNING'], extrasFailed: 0 }
    }
    ProductPushService.runningStores.add(storeUuid)
    try {
      return await this.pushToStoreInternal(storeUuid)
    } finally {
      ProductPushService.runningStores.delete(storeUuid)
    }
  }

  /**
   * Imports the remote catalog into local DB without creating duplicates.
   * A locally managed product (catalog_source=SIXTH_CUP) keeps our recipe/business data;
   * an imported product mirrors Evotor base fields until an admin edits it.
   */
  async pullFromStore(storeUuid: string): Promise<{ imported: number; updated: number; links: number }> {
    this.ensureSchema()
    if (!this.client.isConfigured) return { imported: 0, updated: 0, links: 0 }
    const remote = await this.remoteProducts(storeUuid)
    const now = Date.now()
    let imported = 0
    let updated = 0
    let links = 0

    for (const item of remote) {
      const evotorUuid = remoteId(item)
      if (!evotorUuid) continue
      const articleNumber = remoteArticleNumber(item)
      const byLink = this.db.prepare(`SELECT product_id FROM product_store_links WHERE store_uuid=? AND evotor_uuid=? LIMIT 1`)
        .get(storeUuid, evotorUuid) as { product_id: number } | undefined
      let productId = byLink?.product_id ?? null

      if (!productId && articleNumber?.startsWith('sc-')) {
        const id = Number(articleNumber.slice(3))
        if (Number.isInteger(id) && id > 0) {
          const exists = this.db.prepare(`SELECT id FROM products WHERE id=?`).get(id) as { id: number } | undefined
          if (exists) productId = exists.id
        }
      }
      if (!productId) {
        const legacy = this.db.prepare(`SELECT id FROM products WHERE evotor_uuid=? LIMIT 1`).get(evotorUuid) as { id: number } | undefined
        productId = legacy?.id ?? null
      }

      const name = String(item.name ?? '').trim() || `Товар ${evotorUuid.slice(0, 8)}`
      const price = remoteNumber(item.price ?? item.priceOut ?? item.price_out) ?? 0
      const allowToSell = item.allowToSell ?? item.allow_to_sell
      const tax = typeof item.tax === 'string' ? item.tax : 'NO_VAT'
      const measure = typeof item.measureName === 'string' ? item.measureName : (typeof item.measure === 'string' ? item.measure : 'шт')

      // Do NOT auto-import every Evotor SKU into 6.7 (stores can have 1000+ items).
      // Only refresh already linked products or article sc-{id}.
      if (!productId) {
        continue
      }

      const local = this.db.prepare(`SELECT catalog_source FROM products WHERE id=?`).get(productId) as { catalog_source: string } | undefined
      if (local?.catalog_source !== 'SIXTH_CUP') {
        this.db.prepare(`UPDATE products SET name=?,price=?,available=?,tax=?,measure=?,updated_at=? WHERE id=?`)
          .run(name, price, allowToSell === false ? 0 : 1, tax, measure, now, productId)
        updated++
      }

      const linkResult = this.db.prepare(`INSERT INTO product_store_links(product_id,store_uuid,evotor_uuid,last_pulled_at,last_error)
        VALUES(?,?,?,?,NULL)
        ON CONFLICT(product_id,store_uuid) DO UPDATE SET evotor_uuid=excluded.evotor_uuid,last_pulled_at=excluded.last_pulled_at,last_error=NULL`)
        .run(productId, storeUuid, evotorUuid, now)
      if (linkResult.changes) links++

      const localFull = this.db.prepare(`SELECT * FROM products WHERE id=?`).get(productId) as LocalProduct | undefined
      const managed = localFull?.catalog_source === 'SIXTH_CUP'
      const inSync = managed && localFull ? this.remoteEquivalent(localFull, item) : false
      const storedHash = managed && localFull && inSync ? this.syncHash(localFull) : hashPayload(item)
      const storedStatus = managed && !inSync ? 'PENDING' : 'SYNCED'
      this.db.prepare(`INSERT INTO evotor_products(product_id,variant,store_uuid,evotor_uuid,last_hash,last_synced_at,status,last_error,raw_json)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(product_id,variant,store_uuid) DO UPDATE SET evotor_uuid=excluded.evotor_uuid,last_hash=excluded.last_hash,last_synced_at=excluded.last_synced_at,status=excluded.status,last_error=NULL,raw_json=excluded.raw_json`)
        .run(productId, '', storeUuid, evotorUuid, storedHash, now, storedStatus, null, JSON.stringify(item))
    }
    this.db.prepare(`INSERT INTO evotor_sync_state(store_uuid,last_seen_close_ms,last_products_sync_at)
      VALUES(?,0,?) ON CONFLICT(store_uuid) DO UPDATE SET last_products_sync_at=excluded.last_products_sync_at`).run(storeUuid, now)
    return { imported, updated, links }
  }

  async syncStore(storeUuid: string): Promise<{ pulled: { imported: number; updated: number; links: number }; pushed: { pushed: number; linked: number; errors: string[]; extrasFailed: number } }> {
    if (ProductPushService.runningStores.has(storeUuid)) {
      return { pulled: { imported: 0, updated: 0, links: 0 }, pushed: { pushed: 0, linked: 0, errors: ['EVOTOR_SYNC_ALREADY_RUNNING'], extrasFailed: 0 } }
    }
    ProductPushService.runningStores.add(storeUuid)
    try {
      const pulled = await this.pullFromStore(storeUuid)
      const pushed = await this.pushToStoreInternal(storeUuid)
      return { pulled, pushed }
    } finally {
      ProductPushService.runningStores.delete(storeUuid)
    }
  }

  
  /**
   * Like 1C "clear nomenclature": list all Cloud products → DELETE → clear our links → push from 6.7.
   * Does not delete rows in local `products` table — only Evotor side + link table.
   */
  async wipeCloudAndResync(storeUuid: string): Promise<{
    listed: number
    deleted: number
    deleteErrors: string[]
    linksCleared: number
    pushed: number
    pushErrors: string[]
    extrasFailed: number
  }> {
    const deleteErrors: string[] = []
    let listed = 0
    let deleted = 0
    try {
      const remote = await this.remoteProducts(storeUuid)
      listed = remote.length
      const linked = new Set((this.db.prepare(`SELECT evotor_uuid FROM product_store_links WHERE store_uuid=? AND evotor_uuid IS NOT NULL`).all(storeUuid) as { evotor_uuid: string }[]).map((x) => x.evotor_uuid))
      const ids = remote.filter((r) => { const id = remoteId(r); const article = remoteArticleNumber(r); return Boolean((id && linked.has(id)) || (article && /^sc-\d+$/.test(article))) })
        .map((r) => remoteId(r)).filter((id): id is string => Boolean(id))
      // Prefer DELETE; on failure collect and continue
      try {
        if (ids.length) {
          await this.client.deleteCloudProducts(storeUuid, ids)
          deleted = ids.length
        }
      } catch (e) {
        // Fallback: try one-by-one so one bad id does not block all
        for (const id of ids) {
          try {
            await this.client.deleteCloudProducts(storeUuid, [id])
            deleted++
          } catch (e2) {
            deleteErrors.push(`${id.slice(0, 8)}: ${String(e2).slice(0, 160)}`)
          }
        }
        if (!ids.length) deleteErrors.push(String(e).slice(0, 200))
      }
    } catch (e) {
      deleteErrors.push(`list: ${String(e).slice(0, 200)}`)
    }

    const clear = this.db
      .prepare(`DELETE FROM product_store_links WHERE store_uuid=?`)
      .run(storeUuid)
    const linksCleared = Number(clear.changes ?? 0)

    const push = await this.pushToStore(storeUuid)
    return {
      listed,
      deleted,
      deleteErrors: deleteErrors.slice(0, 20),
      linksCleared,
      pushed: push.pushed,
      pushErrors: push.errors.slice(0, 20),
      extrasFailed: push.extrasFailed,
    }
  }

  async verifyStore(storeUuid: string): Promise<{ drift: { productId: number; evotorUuid: string; issue: string }[]; count: number }> {
    this.ensureSchema()
    const raw = await this.remoteProducts(storeUuid)
    const actual = new Map(raw.map((x) => [remoteId(x) ?? '', x]))
    const drift: { productId: number; evotorUuid: string; issue: string }[] = []
    const links = this.db.prepare(`SELECT p.id AS productId, l.evotor_uuid AS evotorUuid
      FROM product_store_links l JOIN products p ON p.id=l.product_id
      WHERE l.store_uuid=? AND l.evotor_uuid IS NOT NULL`).all(storeUuid) as { productId: number; evotorUuid: string }[]
    for (const link of links) {
      const p = this.db.prepare(`SELECT * FROM products WHERE id=?`).get(link.productId) as LocalProduct | undefined
      if (!p) continue
      const remote = actual.get(link.evotorUuid)
      if (!remote) drift.push({ productId: p.id, evotorUuid: link.evotorUuid, issue: 'MISSING_IN_EVOTOR' })
      else if (!this.remoteEquivalent(p, remote)) drift.push({ productId: p.id, evotorUuid: link.evotorUuid, issue: 'FIELDS_DIFFER' })
    }
    return { drift, count: raw.length }
  }
}
