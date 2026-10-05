/**
 * Apply Evotor tables (MASTER-TZ §7). Idempotent CREATE IF NOT EXISTS.
 * Call from db bootstrap after main schema.
 */
import type Database from 'better-sqlite3'

export function migrateEvotorSchema(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS evotor_stores (
  store_uuid TEXT PRIMARY KEY,
  name TEXT,
  local_store_id INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS evotor_devices (
  device_uuid TEXT PRIMARY KEY,
  store_uuid TEXT NOT NULL,
  name TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS evotor_docs (
  store_uuid TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  type TEXT NOT NULL,
  device_uuid TEXT,
  session_id TEXT,
  number INTEGER,
  close_date_ms INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('poll','webhook')),
  status TEXT NOT NULL CHECK (status IN ('RECEIVED','PROCESSING','PROCESSED','IGNORED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  wl_json TEXT,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  PRIMARY KEY (store_uuid, doc_id)
);
CREATE INDEX IF NOT EXISTS idx_evotor_docs_status ON evotor_docs(status, close_date_ms);

CREATE TABLE IF NOT EXISTS evotor_sync_state (
  store_uuid TEXT PRIMARY KEY,
  last_seen_close_ms INTEGER NOT NULL DEFAULT 0,
  last_fast_at INTEGER,
  last_hourly_at INTEGER,
  last_daily_at INTEGER,
  lock_until INTEGER,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'OK'
);

CREATE TABLE IF NOT EXISTS evotor_products (
  product_id INTEGER NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  store_uuid TEXT NOT NULL,
  evotor_uuid TEXT NOT NULL,
  last_hash TEXT,
  last_synced_at INTEGER,
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_error TEXT,
  PRIMARY KEY (product_id, variant, store_uuid)
);

CREATE TABLE IF NOT EXISTS evotor_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_uuid TEXT NOT NULL,
  entity TEXT NOT NULL CHECK (entity IN ('PRODUCT','GROUP','SCHEME','EXTRA','CONFIG')),
  entity_key TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('UPSERT','DISABLE','DELETE')),
  payload_hash TEXT,
  priority INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS evotor_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER,
  store_uuid TEXT,
  endpoint TEXT,
  http_status INTEGER,
  duration_ms INTEGER,
  request_id TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS loyalty_ops (
  doc_store TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('SELL','PAYBACK')),
  card_id TEXT,
  op_claimed TEXT,
  q_claimed INTEGER,
  free INTEGER,
  cb INTEGER,
  voucher TEXT,
  disc_claimed TEXT,
  result_rub REAL,
  cups_counted INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (doc_store, doc_id)
);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('EARN','SPEND','REVERSAL','ADJUSTMENT')),
  cups_delta INTEGER NOT NULL DEFAULT 0,
  free_delta INTEGER NOT NULL DEFAULT 0,
  cashback_delta INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (source_type, source_id, card_id, operation)
);

CREATE TABLE IF NOT EXISTS card_denylist (
  card_id TEXT PRIMARY KEY,
  reason TEXT,
  created_at INTEGER,
  released_at INTEGER
);
`)

  // card_id on users if table exists
  try {
    const cols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]
    if (cols.length && !cols.some((c) => c.name === 'card_id')) {
      db.exec(`ALTER TABLE users ADD COLUMN card_id TEXT`)
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_card_id ON users(card_id) WHERE card_id IS NOT NULL`)
    }
  } catch {
    /* users may not exist in unit tests */
  }
}
