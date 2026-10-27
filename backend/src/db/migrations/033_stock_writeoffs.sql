-- Ручное списание (порча, срок, персонал, пробные). Одношаговый документ: создаётся как posted (D-22).
CREATE TABLE IF NOT EXISTS stock_writeoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_uuid TEXT,
  reason TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'posted',
  posted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_writeoff_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  writeoff_id INTEGER NOT NULL REFERENCES stock_writeoffs(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  qty REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wo_lines_doc ON stock_writeoff_lines(writeoff_id);
