-- 041: Схема выбора без цены («с корицей» / «без корицы») — отдельная сущность.
--
-- Аддитивно: новые таблицы + nullable-колонка products.choice_scheme_id.
-- Существующие товары остаются без схемы выбора (автоназначения нет).
-- Выбор — не товар Эвотор: ни uuid, ни цены; на кассе это служебная метка (печать на чеке).

CREATE TABLE IF NOT EXISTS choice_schemes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS choice_scheme_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme_id INTEGER NOT NULL REFERENCES choice_schemes(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_choice_options_scheme ON choice_scheme_options(scheme_id, sort_order, id);

ALTER TABLE products ADD COLUMN choice_scheme_id INTEGER REFERENCES choice_schemes(id);
CREATE INDEX IF NOT EXISTS idx_products_choice_scheme ON products(choice_scheme_id);
