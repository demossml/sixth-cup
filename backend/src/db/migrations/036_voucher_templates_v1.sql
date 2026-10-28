-- V1 ваучеров: расширение шаблонов и учёт гашений (D1).
-- Все изменения аддитивные: старые строки остаются валидными.
ALTER TABLE voucher_templates ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE voucher_templates ADD COLUMN image_url TEXT;
ALTER TABLE voucher_templates ADD COLUMN redemption_mode TEXT NOT NULL DEFAULT 'once';
ALTER TABLE voucher_templates ADD COLUMN max_per_day INTEGER;
ALTER TABLE voucher_templates ADD COLUMN max_total INTEGER;
ALTER TABLE voucher_templates ADD COLUMN stackable_with_free_cup INTEGER NOT NULL DEFAULT 1;

-- Счётчик гашений экземпляра (для multi) и журнал гашений: он же даёт лимит «в сутки»
-- и защиту от повторного гашения по одному чеку.
ALTER TABLE vouchers ADD COLUMN redemptions_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  receipt_id TEXT NOT NULL,
  store_uuid TEXT,
  day INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voucher_redemptions_doc ON voucher_redemptions(voucher_id, receipt_id);
CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_day ON voucher_redemptions(voucher_id, day);
