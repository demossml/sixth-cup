-- 059: палитры бренда и версии макета меню.
--
-- Палитры живут на уровне аккаунта: один бренд — один набор цветов, общий для всех
-- макетов. Версии — снимки документа и темы: к ним можно вернуться, если правки
-- увели лист «не туда». Обе таблицы не касаются каталога и кассы.

CREATE TABLE IF NOT EXISTS menu_palettes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  colors_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_menu_palettes_updated ON menu_palettes(updated_at);

CREATE TABLE IF NOT EXISTS menu_layout_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layout_id INTEGER NOT NULL REFERENCES menu_layouts(id) ON DELETE CASCADE,
  rev INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  note TEXT,
  theme_json TEXT NOT NULL DEFAULT '{}',
  doc_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_menu_layout_versions_layout ON menu_layout_versions(layout_id, created_at DESC);
