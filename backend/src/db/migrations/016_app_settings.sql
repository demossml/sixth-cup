-- Runtime app settings (AI etc). Values never exposed in client bundles.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
