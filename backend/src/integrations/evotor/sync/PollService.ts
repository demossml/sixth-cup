/**
 * Evotor Cloud v1 polling based on the verified Phase-0 behaviour of the test account:
 * X-Authorization, YYYY-MM-DD gtCloseDate/ltCloseDate, and transactions[].
 */
import type Database from 'better-sqlite3'
import { EvotorClient, formatDateWithTime } from '../client/EvotorClient'
import { evotorConfig } from '../../../config'
import { handlePayback, handleSell } from '../processing/SellHandler'
import { log, shortId } from '../../../lib/logBuffer'

function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && Array.isArray((data as { transactions?: unknown[] }).transactions)) {
    return (data as { transactions: unknown[] }).transactions
  }
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown[] }).items)) {
    return (data as { items: unknown[] }).items
  }
  return []
}

function storeIdOf(row: Record<string, unknown>): string | null {
  const id = row.uuid ?? row.id ?? row.storeUuid ?? row.store_id
  return typeof id === 'string' && id ? id : null
}

function docIdOf(row: Record<string, unknown>): string | null {
  const id = row.uuid ?? row.id
  return typeof id === 'string' && id ? id : null
}

function closeDateMs(row: Record<string, unknown>): number {
  const raw = row.closeDate ?? row.close_date
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000
  if (typeof raw === 'string') {
    const t = Date.parse(raw.replace(' ', 'T'))
    if (!Number.isNaN(t)) return t
  }
  return Date.now()
}

function whitelist(row: Record<string, unknown>): string {
  return JSON.stringify({
    id: docIdOf(row),
    type: row.type,
    closeDate: row.closeDate ?? row.close_date,
    store_id: row.storeUuid ?? row.store_id,
    device_id: row.deviceUuid ?? row.device_id,
    extras: row.extras,
    transactions: Array.isArray(row.transactions) ? row.transactions.length : undefined,
  })
}

export class PollService {
  constructor(
    private readonly db: Database.Database,
    private readonly client = new EvotorClient(),
  ) {}

  async ensureStores(): Promise<string[]> {
    const raw = await this.client.getStores()
    const items = asArray(raw)
    const now = Date.now()
    const ids: string[] = []
    const upsert = this.db.prepare(
      `INSERT INTO evotor_stores(store_uuid, name, updated_at) VALUES(?,?,?)
       ON CONFLICT(store_uuid) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`,
    )
    for (const it of items) {
      const o = it as Record<string, unknown>
      const id = storeIdOf(o)
      if (!id) continue
      ids.push(id)
      upsert.run(id, typeof o.name === 'string' ? o.name : null, now)
      this.db.prepare(`INSERT OR IGNORE INTO evotor_sync_state(store_uuid,last_seen_close_ms) VALUES(?,0)`).run(id)
    }
    return ids
  }

  private processDocument(storeUuid: string, doc: Record<string, unknown>) {
    const type = String(doc.type ?? '')
    if (type !== 'SELL' && type !== 'PAYBACK') return
    const extras = doc.extras && typeof doc.extras === 'object' ? doc.extras as Record<string, unknown> : {}
    const hasSc = extras.sc != null
    if (!hasSc) {
      this.db.prepare(`UPDATE evotor_docs SET status='PROCESSED', processed_at=? WHERE store_uuid=? AND doc_id=?`)
        .run(Date.now(), storeUuid, docIdOf(doc))
      return
    }
    try {
      const result = type === 'SELL'
        ? handleSell(this.db, storeUuid, doc)
        : handlePayback(this.db, storeUuid, doc)
      this.db.prepare(`UPDATE evotor_docs SET status=?, processed_at=?, last_error=? WHERE store_uuid=? AND doc_id=?`)
        .run(result.processed ? 'PROCESSED' : 'FAILED', Date.now(), result.processed ? null : (result.reason ?? 'processing failed'), storeUuid, docIdOf(doc))
      const meta = { doc: shortId(docIdOf(doc), 8), store: shortId(storeUuid) }
      if (result.processed) log.info(`evotor ${type} processed${result.reason ? ` (${result.reason})` : ''}`, meta)
      else log.warn(`evotor ${type} rejected: ${result.reason ?? 'processing failed'}`, meta)
    } catch (e) {
      log.error(`evotor ${type} processing failed: ${String(e).slice(0, 200)}`, { doc: shortId(docIdOf(doc), 8), store: shortId(storeUuid) })
      this.db.prepare(`UPDATE evotor_docs SET status='FAILED', attempts=attempts+1, last_error=? WHERE store_uuid=? AND doc_id=?`)
        .run(String(e), storeUuid, docIdOf(doc))
    }
  }

  async pollStore(storeUuid: string, sinceMs: number): Promise<number> {
    const since = formatDateWithTime(new Date(sinceMs || Date.now() - 7 * 86400_000), false)
    const until = formatDateWithTime(new Date(), true)
    const items: Record<string, unknown>[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page++) {
      const raw = await this.client.getDocuments(storeUuid, since, until, undefined, cursor)
      items.push(...(asArray(raw) as Record<string, unknown>[]))
      const paging = raw && typeof raw === 'object' ? (raw as { paging?: { next_cursor?: unknown } }).paging : undefined
      cursor = typeof paging?.next_cursor === 'string' && paging.next_cursor ? paging.next_cursor : undefined
      if (!cursor) break
    }
    let inserted = 0
    const ins = this.db.prepare(`
      INSERT OR IGNORE INTO evotor_docs(
        store_uuid, doc_id, type, device_uuid, session_id, number, close_date_ms,
        source, status, wl_json, raw_json, received_at
      ) VALUES (?,?,?,?,?,?,?,'poll',?,?,?,?)
    `)
    const now = Date.now()
    let maxClose = sinceMs
    for (const doc of items) {
      const id = docIdOf(doc)
      if (!id) continue
      const type = String(doc.type ?? 'UNKNOWN')
      const cms = closeDateMs(doc)
      maxClose = Math.max(maxClose, cms)
      const business = type === 'SELL' || type === 'PAYBACK' || type === 'CORRECTION'
      const r = ins.run(
        storeUuid,
        id,
        type,
        (doc.deviceUuid ?? doc.device_id ?? null) as string | null,
        (doc.sessionUuid ?? doc.session_id ?? null) as string | null,
        (doc.number as number) ?? null,
        cms,
        business ? 'RECEIVED' : 'IGNORED',
        business ? whitelist(doc) : null,
        null, // raw document is not stored: data minimisation
        now,
      )
      if (r.changes > 0) {
        inserted++
        if (business) this.processDocument(storeUuid, doc)
      }
    }
    this.db.prepare(`UPDATE evotor_sync_state SET last_seen_close_ms=MAX(last_seen_close_ms,?),last_fast_at=? WHERE store_uuid=?`)
      .run(maxClose, now, storeUuid)
    return inserted
  }

  async runFast(): Promise<{ stores: number; inserted: number; errors: { storeUuid: string; error: string }[] }> {
    if (!this.client.isConfigured) return { stores: 0, inserted: 0, errors: [] }
    const stores = await this.ensureStores()
    let inserted = 0
    const errors: { storeUuid: string; error: string }[] = []
    const overlap = evotorConfig.fastOverlapMin * 60 * 1000
    for (const s of stores) {
      try {
        const row = this.db.prepare(`SELECT last_seen_close_ms FROM evotor_sync_state WHERE store_uuid=?`).get(s) as { last_seen_close_ms: number } | undefined
        const since = Math.max(0, (row?.last_seen_close_ms ?? 0) - overlap)
        inserted += await this.pollStore(s, since || Date.now() - 5 * 86400_000)
        this.db.prepare(`UPDATE evotor_sync_state SET status='OK',last_error=NULL WHERE store_uuid=?`).run(s)
      } catch (e) {
        const error = String(e)
        errors.push({ storeUuid: s, error })
        this.db.prepare(`UPDATE evotor_sync_state SET status='ERROR',last_error=? WHERE store_uuid=?`).run(error, s)
      }
    }
    return { stores: stores.length, inserted, errors }
  }

  async runHourly(): Promise<{ stores: number; inserted: number }> {
    if (!this.client.isConfigured) return { stores: 0, inserted: 0 }
    const stores = await this.ensureStores()
    const since = Date.now() - evotorConfig.hourlyWindowHours * 3_600_000
    let inserted = 0
    for (const s of stores) inserted += await this.pollStore(s, since)
    this.db.prepare(`UPDATE evotor_sync_state SET last_hourly_at=?`).run(Date.now())
    return { stores: stores.length, inserted }
  }

  async runDaily(): Promise<{ stores: number; inserted: number }> {
    if (!this.client.isConfigured) return { stores: 0, inserted: 0 }
    const stores = await this.ensureStores()
    const since = Date.now() - evotorConfig.dailyWindowDays * 86_400_000
    let inserted = 0
    for (const s of stores) inserted += await this.pollStore(s, since)
    this.db.prepare(`UPDATE evotor_sync_state SET last_daily_at=?`).run(Date.now())
    return { stores: stores.length, inserted }
  }
}
