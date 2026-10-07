CREATE TABLE IF NOT EXISTS loyalty_reservations (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  benefit TEXT NOT NULL,
  status TEXT NOT NULL,
  store_uuid TEXT,
  terminal_id TEXT,
  card_ref TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  sell_doc_id TEXT,
  paid_cups_snapshot INTEGER NOT NULL DEFAULT 0,
  free_available_snapshot INTEGER NOT NULL DEFAULT 0,
  cashback_snapshot INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_loyalty_res_user_status ON loyalty_reservations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_loyalty_res_expires ON loyalty_reservations(expires_at);
