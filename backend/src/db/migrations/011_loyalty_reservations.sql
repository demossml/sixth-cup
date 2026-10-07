-- Reservation of loyalty benefits at the till (QR = identity, backend = state).
-- One active (RESERVED) reservation per card, enforced by a partial unique index.
CREATE TABLE IF NOT EXISTS loyalty_reservations (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  benefit_free INTEGER NOT NULL DEFAULT 0,
  benefit_cb INTEGER NOT NULL DEFAULT 0,
  store_uuid TEXT,
  device_uuid TEXT,
  status TEXT NOT NULL DEFAULT 'RESERVED',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  doc_store TEXT,
  doc_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_res_active ON loyalty_reservations(card_id) WHERE status='RESERVED';
CREATE INDEX IF NOT EXISTS idx_loyalty_res_card ON loyalty_reservations(card_id, created_at);
