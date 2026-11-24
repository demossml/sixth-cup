CREATE TABLE IF NOT EXISTS tech_card_import_markers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES tech_cards(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('created', 'updated')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tech_card_import_markers_review
  ON tech_card_import_markers(card_id, reviewed_at);
