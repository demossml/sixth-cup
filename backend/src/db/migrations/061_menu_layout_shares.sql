-- P2-5: просмотр макета по ссылке.
-- Токен — случайная строка; отзыв = revoked_at, история не удаляется, чтобы было видно, кто и когда делился.
CREATE TABLE IF NOT EXISTS menu_layout_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layout_id INTEGER NOT NULL REFERENCES menu_layouts(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_menu_layout_shares_layout ON menu_layout_shares(layout_id, created_at DESC);
