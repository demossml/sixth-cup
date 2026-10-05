/**
 * Document poll (MASTER-TZ §8). Insert only; handlers come after Phase 0.6.
 */
import type Database from 'better-sqlite3'
import { EvotorClient } from '../client/EvotorClient'
import { evotorConfig } from '../../../config'
import type { EvotorDocumentBase } from '../types/common'

function closeDateMs(doc: EvotorDocumentBase): number {
  const raw = doc.close_date ?? (doc as { closeDate?: string }).closeDate
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') {
    const n = Number(raw)
    if (!Number.isNaN(n) && n > 1e12) return n
    if (!Number.isNaN(n) && n > 1e9) return n * 1000
    const t = Date.parse(raw)
    if (!Number.isNaN(t)) return t
  }
  return Date.now()
}

function whitelist(doc: EvotorDocumentBase): string {
  const body = (doc.body ?? {}) as Record<string, unknown>
  const positions = Array.isArray(body.positions)
    ? (body.positions as Record<string, unknown>[]).map((p) => ({
        product_id: p.product_id,
        quantity: p.quantity,
        price: p.price,
        sum: p.sum,
        result_sum: p.result_sum,
        result_price: p.result_price,
        doc_distributed_discount: p.doc_distributed_discount,
      }))
    : []
  const wl = {
    id: doc.id,
    type: doc.type,
    number: doc.number,
    close_date: doc.close_date,
    session_id: doc.session_id,
    device_id: doc.device_id,
    store_id: doc.store_id,
    extras: doc.extras,
    body: {
      positions,
      sum: body.sum,
      result_sum: body.result_sum,
      doc_discounts: body.doc_discounts,
      base_document_id: body.base_document_id,
      base_document_number: body.base_document_number,
    },
  }
  return JSON.stringify(wl)
}

export class PollService {
  constructor(
    private readonly db: Database.Database,
    private readonly client = new EvotorClient(),
  ) {}

  async ensureStores(): Promise<string[]> {
    const raw = await this.client.getStores()
    const items = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] }).items ?? [])
    const now = Date.now()
    const ids: string[] = []
    const upsert = this.db.prepare(
      `INSERT INTO evotor_stores(store_uuid, name, updated_at) VALUES(?,?,?)
       ON CONFLICT(store_uuid) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`,
    )
    for (const it of items) {
      const o = it as { id?: string; uuid?: string; name?: string }
      const id = o.id ?? o.uuid
      if (!id) continue
      ids.push(id)
      upsert.run(id, o.name ?? null, now)
      this.db
        .prepare(
          `INSERT OR IGNORE INTO evotor_sync_state(store_uuid, last_seen_close_ms) VALUES(?,0)`,
        )
        .run(id)
    }
    return ids
  }

  async pollStore(storeUuid: string, sinceMs: number): Promise<number> {
    let cursor: string | undefined
    let page = 0
    let inserted = 0
    const ins = this.db.prepare(`
      INSERT OR IGNORE INTO evotor_docs(
        store_uuid, doc_id, type, device_uuid, session_id, number, close_date_ms,
        source, status, wl_json, received_at
      ) VALUES (?,?,?,?,?,?,?,'poll',?,?,?)
    `)

    for (;;) {
      const res = await this.client.getDocuments(storeUuid, {
        since: cursor ? undefined : sinceMs,
        cursor,
      })
      const items = (res.items ?? []) as EvotorDocumentBase[]
      const now = Date.now()
      let maxClose = sinceMs

      for (const doc of items) {
        const id = doc.id
        if (!id) continue
        const type = String(doc.type ?? 'UNKNOWN')
        const cms = closeDateMs(doc)
        maxClose = Math.max(maxClose, cms)
        const business = type === 'SELL' || type === 'PAYBACK' || type === 'CORRECTION'
        const status = business ? 'RECEIVED' : 'IGNORED'
        const wl = business ? whitelist(doc) : null
        const r = ins.run(
          storeUuid,
          id,
          type,
          doc.device_id ?? null,
          doc.session_id ?? null,
          doc.number ?? null,
          cms,
          status,
          wl,
          now,
        )
        if (r.changes > 0) inserted++
      }

      this.db
        .prepare(
          `UPDATE evotor_sync_state SET last_seen_close_ms = MAX(last_seen_close_ms, ?), last_fast_at = ? WHERE store_uuid = ?`,
        )
        .run(maxClose, now, storeUuid)

      cursor = res.paging?.next_cursor
      page++
      if (!cursor || page > 200) break
    }
    return inserted
  }

  /** Fast window for all stores. */
  async runFast(): Promise<{ stores: number; inserted: number }> {
    if (!this.client.isConfigured) return { stores: 0, inserted: 0 }
    const stores = await this.ensureStores()
    let inserted = 0
    const overlap = evotorConfig.fastOverlapMin * 60 * 1000
    for (const s of stores) {
      const row = this.db
        .prepare(`SELECT last_seen_close_ms FROM evotor_sync_state WHERE store_uuid=?`)
        .get(s) as { last_seen_close_ms: number } | undefined
      const since = Math.max(0, (row?.last_seen_close_ms ?? 0) - overlap)
      inserted += await this.pollStore(s, since || Date.now() - 7 * 86400_000)
    }
    return { stores: stores.length, inserted }
  }
}
