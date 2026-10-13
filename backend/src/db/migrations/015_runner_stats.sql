-- Runner arcade stats only — no loyalty rewards.
CREATE TABLE IF NOT EXISTS runner_runs (
  run_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  level_id TEXT NOT NULL,
  beans_collected INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  completed INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runner_runs_user ON runner_runs(user_id, created_at);

CREATE TABLE IF NOT EXISTS runner_progress (
  user_id INTEGER NOT NULL,
  level_id TEXT NOT NULL,
  completed_runs INTEGER NOT NULL DEFAULT 0,
  best_beans INTEGER NOT NULL DEFAULT 0,
  best_duration_ms INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, level_id)
);
