-- Runner multi-level progression. Stats only — no loyalty/cashback side effects.
-- Applied once via schema_migrations id = 017_runner_levels.
ALTER TABLE runner_progress ADD COLUMN stars INTEGER NOT NULL DEFAULT 0;
