-- Account recovery without PII: the user keeps a random secret (shown as QR / text); we store only its hash.
ALTER TABLE users ADD COLUMN recovery_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_recovery_hash ON users(recovery_hash) WHERE recovery_hash IS NOT NULL;
