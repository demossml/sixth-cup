-- Mini-game sessions and daily reward claims (server is source of truth).
CREATE TABLE IF NOT EXISTS game_sessions (
  session_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER,
  stage_reached INTEGER NOT NULL DEFAULT 0,
  reward_kop INTEGER NOT NULL DEFAULT 0,
  client_nonce TEXT
);
CREATE INDEX IF NOT EXISTS idx_game_sessions_user ON game_sessions(user_id, created_at);

CREATE TABLE IF NOT EXISTS game_daily (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  rewards INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
