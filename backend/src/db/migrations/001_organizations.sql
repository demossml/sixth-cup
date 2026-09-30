CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  inn TEXT NOT NULL,
  kpp TEXT,
  tax_regime TEXT NOT NULL DEFAULT 'usn_income',
  vat_rate INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- SQLite: ADD COLUMN is no-op-safe only if we check; runner applies once
ALTER TABLE stores ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
