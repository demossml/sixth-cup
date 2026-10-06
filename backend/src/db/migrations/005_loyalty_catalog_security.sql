-- Security and catalog v1: opaque signed card ids, deterministic Evotor mapping,
-- explicit product accounting fields and seasonal availability.
ALTER TABLE users ADD COLUMN card_id TEXT;
UPDATE users SET card_id=lower(hex(randomblob(18))) WHERE card_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_card_id ON users(card_id) WHERE card_id IS NOT NULL;

ALTER TABLE products ADD COLUMN tax TEXT DEFAULT 'NO_VAT';
ALTER TABLE products ADD COLUMN measure TEXT DEFAULT 'шт';
ALTER TABLE products ADD COLUMN cost_price_kopecks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN free_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN season_start_at INTEGER;
ALTER TABLE products ADD COLUMN season_end_at INTEGER;
ALTER TABLE products ADD COLUMN evotor_extra_json TEXT;

CREATE INDEX IF NOT EXISTS idx_products_season ON products(season_start_at, season_end_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_ops_card ON loyalty_ops(card_id, created_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_card ON loyalty_ledger(card_id, created_at);
CREATE INDEX IF NOT EXISTS idx_evotor_outbox_ready ON evotor_outbox(status, next_at, priority);
