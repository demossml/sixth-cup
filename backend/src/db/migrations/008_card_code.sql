-- Human-entered loyalty card number. Canonical form is digits without leading zeroes.
-- The code is intentionally separate from opaque card_id used by signed QR proofs.
ALTER TABLE users ADD COLUMN card_code TEXT;

-- Preserve all existing users and give them stable sequential card numbers.
UPDATE users
SET card_code = CAST((SELECT COUNT(*) FROM users AS older WHERE older.id <= users.id) AS TEXT)
WHERE card_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_card_code ON users(card_code);
