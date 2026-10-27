/**
 * Evotor Cloud v1 polling based on the verified Phase-0 behaviour of the test account:
 * X-Authorization, YYYY-MM-DD gtCloseDate/ltCloseDate, and transactions[].
 */
import type Database from 'better-sqlite3'
import { EvotorClient, formatDateWithTime } from '../client/EvotorClient'
import { evotorConfig } from '../../../config'
import { handlePayback, handleSell } from '../processing/SellHandler'
import { applyStockForDocument } from '../processing/StockHandler'
import { hasLoyaltySc } from '../loyaltyExtras'
import { log, shortId } from '../../../lib/logBuffer'
import { anyTokenConfigured, clientForStore, listActivePlainTokens } from '../tokenStore'


/** Only stores the owner marked for sync in admin (sync_enabled=1). */
function enabledStoreUuids(db: Database.Database): string[] {
  try {
    const cols = db.prepare(`PRAGMA table_info(evotor_stores)`).all() as { name: string }[]
    if (!cols.some((c) => c.name === 'sync_enabled')) {
      db.exec(`ALTER TABLE evotor_stores ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 0`)
    }
    return (
      db.prepare(`SELECT store_uuid FROM evotor_stores WHERE COALESCE(sync_enabled,0)=1`).all() as {
        store_uuid: string
      }[]
    ).map((r) => r.store_uuid)
  } catch {
    return []
  }
}

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

/** Сколько раз пробуем переобработать документ и с какой паузой (L-07). */
export const RETRY_MAX_ATTEMPTS = 10
export function retryDelayMs(attempts: number): number {
  const steps = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]
  return steps[Math.min(Math.max(0, attempts - 1), steps.length - 1)]
}
/** Ошибки данных не лечатся повтором: карта не та, ссылки нет, id нет. */
const PERMANENT_REASONS = [
  'invalid signed card token',
  'card not found',
  'card code not found',
  'invalid card code',
  'missing baseDocumentUUID',
  'missing document id',
  'no loyalty extra',
]
export function isRetryableReason(reason: string | undefined): boolean {
  if (!reason) return true
  return !PERMANENT_REASONS.includes(reason)
}

export class PollService {
  /** Per-run counters so the heartbeat can tell "Cloud returned nothing" from "documents already known". */
  private stats = { seen: 0, sellSeen: 0 }

  constructor(
    private readonly db: Database.Database,
    /** Injected for tests; production passes nothing and clients are resolved per store token. */
    private readonly client?: EvotorClient,
    /** Подмена склада в тестах (Q-05); в продакшене — реальная функция. */
    private readonly deps: { applyStock?: typeof applyStockForDocument } = {},
  ) {}

  async ensureStores(): Promise<string[]> {
    const tokens = listActivePlainTokens(this.db)
    if (tokens.length === 0) return []
    const now = Date.now()
    const ids: string[] = []
    const upsert = this.db.prepare(
      `INSERT INTO evotor_stores(store_uuid, name, updated_at) VALUES(?,?,?)
       ON CONFLICT(store_uuid) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`,
    )
    for (const tok of tokens) {
      try {
        const raw = await (this.client ?? new EvotorClient(tok)).getStores()
        const items = asArray(raw)
        for (const it of items) {
          const o = it as Record<string, unknown>
          const id = storeIdOf(o)
          if (!id) continue
          if (!ids.includes(id)) ids.push(id)
          upsert.run(id, typeof o.name === 'string' ? o.name : null, now)
          this.db.prepare(`INSERT OR IGNORE INTO evotor_sync_state(store_uuid,last_seen_close_ms) VALUES(?,0)`).run(id)
        }
      } catch (e) {
        log.error('evotor ensureStores token failed', { error: String(e).slice(0, 160) })
      }
    }
    return ids
  }

  /**
   * Документ кассы: сначала лояльность (как было), затем склад.
   * Склад идёт вторым, чтобы его ошибка не затирала статус лояльности (W05).
   */
  private processDocument(storeUuid: string, doc: Record<string, unknown>) {
    const type = String(doc.type ?? '')
    if (type !== 'SELL' && type !== 'PAYBACK') return
    this.processLoyalty(storeUuid, doc, type)
    this.processStock(storeUuid, doc)
  }

  /** Склад: сырьё списывается на любом чеке, независимо от карты (Q-01). */
  private processStock(storeUuid: string, doc: Record<string, unknown>) {
    const id = docIdOf(doc) ?? ''
    try {
      const apply = this.deps.applyStock ?? applyStockForDocument
      const result = apply(this.db, storeUuid, doc)
      log.info('evotor stock applied', {
        doc: shortId(id, 8),
        store: shortId(storeUuid),
        result: JSON.stringify(result).slice(0, 200),
      })
    } catch (e) {
      // D-04: продажа и лояльность уже прошли — документ остаётся PROCESSED, но ошибка обязана
      // быть видна: лог, «Споры» и `evotor_docs.last_error` (Q-05).
      const msg = `stock: ${String(e).slice(0, 300)}`
      log.error(`evotor stock failed: ${msg}`, { doc: shortId(id, 8), store: shortId(storeUuid) })
      try {
        this.db
          .prepare(`INSERT INTO disputes(kind,receipt_id,details,created_at) VALUES(?,?,?,?)`)
          .run('stock_writeoff_failed', id, msg, Date.now())
        this.db
          .prepare(`UPDATE evotor_docs SET last_error=? WHERE store_uuid=? AND doc_id=?`)
          .run(msg, storeUuid, id)
      } catch (e2) {
        log.error('evotor stock failure not recorded', { error: String(e2).slice(0, 160) })
      }
    }
  }

  private processLoyalty(storeUuid: string, doc: Record<string, unknown>, type: string) {
    const extras = doc.extras && typeof doc.extras === 'object' ? doc.extras as Record<string, unknown> : {}
    const hasSc = hasLoyaltySc(extras)
    if (!hasSc) {
      this.db.prepare(`UPDATE evotor_docs SET status='PROCESSED', processed_at=? WHERE store_uuid=? AND doc_id=?`)
        .run(Date.now(), storeUuid, docIdOf(doc))
      log.info(`evotor ${type} skip no loyalty extra`, { doc: shortId(docIdOf(doc), 8), store: shortId(storeUuid) })
      return
    }
    try {
      const result = type === 'SELL'
        ? handleSell(this.db, storeUuid, doc)
        : handlePayback(this.db, storeUuid, doc)
      const meta = { doc: shortId(docIdOf(doc), 8), store: shortId(storeUuid) }
      if (result.processed) {
        this.db
          .prepare(`UPDATE evotor_docs SET status='PROCESSED', processed_at=?, last_error=NULL, next_retry_at=NULL WHERE store_uuid=? AND doc_id=?`)
          .run(Date.now(), storeUuid, docIdOf(doc))
        log.info(`evotor ${type} processed${result.reason ? ` (${result.reason})` : ''}`, meta)
      } else if (isRetryableReason(result.reason)) {
        // L-07: базовый чек мог ещё не прийти в окно poll — ставим в очередь на повтор.
        this.scheduleRetry(storeUuid, docIdOf(doc) ?? '', result.reason ?? 'processing failed')
        log.warn(`evotor ${type} deferred for retry: ${result.reason ?? 'processing failed'}`, meta)
      } else {
        this.failTerminal(storeUuid, docIdOf(doc) ?? '', result.reason ?? 'processing failed')
        log.warn(`evotor ${type} rejected: ${result.reason ?? 'processing failed'}`, meta)
      }
    } catch (e) {
      log.error(`evotor ${type} processing failed: ${String(e).slice(0, 200)}`, { doc: shortId(docIdOf(doc), 8), store: shortId(storeUuid) })
      this.scheduleRetry(storeUuid, docIdOf(doc) ?? '', String(e))
    }
  }

  /** Попытка не удалась, но её имеет смысл повторить: ставим next_retry_at или закрываем окончательно. */
  private scheduleRetry(storeUuid: string, docId: string, reason: string) {
    const row = this.db
      .prepare(`SELECT attempts FROM evotor_docs WHERE store_uuid=? AND doc_id=?`)
      .get(storeUuid, docId) as { attempts: number } | undefined
    const attempts = (row?.attempts ?? 0) + 1
    if (attempts >= RETRY_MAX_ATTEMPTS) {
      this.failTerminal(storeUuid, docId, `giving up after ${attempts} attempts: ${reason}`, attempts)
      return
    }
    this.db
      .prepare(`UPDATE evotor_docs SET status='FAILED', attempts=?, last_error=?, next_retry_at=? WHERE store_uuid=? AND doc_id=?`)
      .run(attempts, reason.slice(0, 300), Date.now() + retryDelayMs(attempts), storeUuid, docId)
    log.info('evotor document scheduled for retry', {
      doc: shortId(docId, 8),
      store: shortId(storeUuid),
      attempts,
      reason: reason.slice(0, 120),
    })
  }

  /** Окончательный отказ: документ больше не переобрабатывается. */
  private failTerminal(storeUuid: string, docId: string, reason: string, attempts?: number) {
    const row = this.db
      .prepare(`SELECT attempts FROM evotor_docs WHERE store_uuid=? AND doc_id=?`)
      .get(storeUuid, docId) as { attempts: number } | undefined
    const tries = attempts ?? (row?.attempts ?? 0) + 1
    this.db
      .prepare(`UPDATE evotor_docs SET status='FAILED', attempts=?, last_error=?, next_retry_at=NULL WHERE store_uuid=? AND doc_id=?`)
      .run(tries, reason.slice(0, 300), storeUuid, docId)
    if (tries >= RETRY_MAX_ATTEMPTS) {
      log.error('evotor document retries exhausted', { doc: shortId(docId, 8), store: shortId(storeUuid), attempts: tries })
    }
  }

  /**
   * L-07: повторная обработка отложенных документов. Сырой документ не хранится
   * (data minimisation), поэтому перечитываем узкое окно Cloud вокруг даты чека.
   */
  private async retryPending(storeUuid: string): Promise<number> {
    const rows = this.db
      .prepare(
        `SELECT doc_id AS docId, close_date_ms AS closeMs FROM evotor_docs
         WHERE store_uuid=? AND status='FAILED' AND next_retry_at IS NOT NULL AND next_retry_at<=?
         ORDER BY next_retry_at LIMIT 25`,
      )
      .all(storeUuid, Date.now()) as { docId: string; closeMs: number }[]
    if (!rows.length) return 0

    const client = this.client ?? clientForStore(this.db, storeUuid)
    let retried = 0
    for (const row of rows) {
      try {
        const since = formatDateWithTime(new Date(Number(row.closeMs) - 6 * 3600_000), false)
        const until = formatDateWithTime(new Date(Number(row.closeMs) + 6 * 3600_000), true)
        const raw = await client.getDocuments(storeUuid, since, until)
        const doc = (asArray(raw) as Record<string, unknown>[]).find((d) => docIdOf(d) === row.docId)
        if (!doc) {
          this.scheduleRetry(storeUuid, row.docId, 'retry: document not found in cloud window')
          continue
        }
        this.processDocument(storeUuid, doc)
        retried++
      } catch (e) {
        this.scheduleRetry(storeUuid, row.docId, `retry failed: ${String(e)}`)
      }
    }
    if (retried) log.info('evotor retry pass', { store: shortId(storeUuid), docs: retried })
    return retried
  }

  async pollStore(storeUuid: string, sinceMs: number): Promise<number> {
    const since = formatDateWithTime(new Date(sinceMs || Date.now() - 7 * 86400_000), false)
    const until = formatDateWithTime(new Date(), true)
    const items: Record<string, unknown>[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page++) {
      const raw = await (this.client ?? clientForStore(this.db, storeUuid)).getDocuments(storeUuid, since, until, undefined, cursor)
      items.push(...(asArray(raw) as Record<string, unknown>[]))
      const paging = raw && typeof raw === 'object' ? (raw as { paging?: { next_cursor?: unknown } }).paging : undefined
      cursor = typeof paging?.next_cursor === 'string' && paging.next_cursor ? paging.next_cursor : undefined
      if (!cursor) break
    }
    let inserted = 0
    this.stats.seen += items.length
    this.stats.sellSeen += items.filter((d) => String(d.type ?? '') === 'SELL').length
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
    // L-07: после разбора новых документов пробуем отложенные (например, PAYBACK без базового SELL).
    await this.retryPending(storeUuid)
    return inserted
  }

  async runFast(): Promise<{ stores: number; inserted: number; seen: number; sellSeen: number; errors: { storeUuid: string; error: string }[] }> {
    this.stats = { seen: 0, sellSeen: 0 }
    if (!anyTokenConfigured(this.db)) return { stores: 0, inserted: 0, seen: 0, sellSeen: 0, errors: [] }
    // Refresh store list from Cloud (names), but poll ONLY sync_enabled=1
    try {
      await this.ensureStores()
    } catch (e) {
      log.error('evotor ensureStores failed', { error: String(e).slice(0, 200) })
    }
    const stores = enabledStoreUuids(this.db)
    if (stores.length === 0) {
      log.info('evotor poll skipped — no stores with sync_enabled=1')
      return { stores: 0, inserted: 0, seen: 0, sellSeen: 0, errors: [] }
    }
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
    return { stores: stores.length, inserted, seen: this.stats.seen, sellSeen: this.stats.sellSeen, errors }
  }

  async runHourly(): Promise<{ stores: number; inserted: number }> {
    if (!anyTokenConfigured(this.db)) return { stores: 0, inserted: 0 }
    try { await this.ensureStores() } catch { /* list refresh best-effort */ }
    const stores = enabledStoreUuids(this.db)
    if (stores.length === 0) return { stores: 0, inserted: 0 }
    const since = Date.now() - evotorConfig.hourlyWindowHours * 3_600_000
    let inserted = 0
    for (const s of stores) inserted += await this.pollStore(s, since)
    this.db.prepare(`UPDATE evotor_sync_state SET last_hourly_at=?`).run(Date.now())
    return { stores: stores.length, inserted }
  }

  async runDaily(): Promise<{ stores: number; inserted: number }> {
    if (!anyTokenConfigured(this.db)) return { stores: 0, inserted: 0 }
    try { await this.ensureStores() } catch { /* list refresh best-effort */ }
    const stores = enabledStoreUuids(this.db)
    if (stores.length === 0) return { stores: 0, inserted: 0 }
    const since = Date.now() - evotorConfig.dailyWindowDays * 86_400_000
    let inserted = 0
    for (const s of stores) inserted += await this.pollStore(s, since)
    this.db.prepare(`UPDATE evotor_sync_state SET last_daily_at=?`).run(Date.now())
    return { stores: stores.length, inserted }
  }
}
