/**
 * Document poll — workApp style (v1 gtCloseDate/ltCloseDate), fixed token.
 * Insert-only; loyalty handlers after FACTS 0.6.
 */
import type Database from 'better-sqlite3'
import { EvotorClient, formatDateWithTime } from '../client/EvotorClient'
import { evotorConfig } from '../../../config'

function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
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
  const transactions = row.transactions
  const body = row.body
  return JSON.stringify({
    id: docIdOf(row),
    type: row.type,
    closeDate: row.closeDate ?? row.close_date,
    store_id: row.storeUuid ?? row.store_id,
    device_id: row.deviceUuid ?? row.device_id,
    extras: row.extras,
    // v1 often uses transactions[]; v2 uses body — keep both keys for FACTS
    transactions: Array.isArray(transactions) ? transactions.length : undefined,
    body: body && typeof body === 'object' ? { keys: Object.keys(body as object) } : undefined,
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
      upsert.run(id, (o.name as string) ?? null, now)
      this.db
        .prepare(
          `INSERT OR IGNORE INTO evotor_sync_state(store_uuid, last_seen_close_ms) VALUES(?,0)`,
        )
        .run(id)
    }
    return ids
  }

  async pollStore(storeUuid: string, sinceMs: number): Promise<number> {
    const since = formatDateWithTime(new Date(sinceMs || Date.now() - 7 * 86400_000), false)
    const until = formatDateWithTime(new Date(), true)
    // All types first (like workApp getDoc); filter in DB
    const raw = await this.client.getDocuments(storeUuid, since, until)
    const items = asArray(raw) as Record<string, unknown>[]
    let inserted = 0
    const ins = this.db.prepare(`
      INSERT OR IGNORE INTO evotor_docs(
        store_uuid, doc_id, type, device_uuid, session_id, number, close_date_ms,
        source, status, wl_json, received_at
      ) VALUES (?,?,?,?,?,?,?,'poll',?,?,?)
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
        now,
      )
      if (r.changes > 0) inserted++
    }

    this.db
      .prepare(
        `UPDATE evotor_sync_state SET last_seen_close_ms = MAX(last_seen_close_ms, ?), last_fast_at = ? WHERE store_uuid = ?`,
      )
      .run(maxClose, now, storeUuid)

    return inserted
  }

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
      inserted += await this.pollStore(s, since || Date.now() - 5 * 86400_000)
    }
    return { stores: stores.length, inserted }
  }
}
