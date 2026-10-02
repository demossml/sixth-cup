-- Modifiers (syrups, toppings) + schemes + product recipe (staff)

CREATE TABLE IF NOT EXISTS modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  group_key TEXT NOT NULL DEFAULT 'other',
  available INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS modifier_schemes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS modifier_scheme_items (
  scheme_id INTEGER NOT NULL REFERENCES modifier_schemes(id) ON DELETE CASCADE,
  modifier_id INTEGER NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
  required INTEGER NOT NULL DEFAULT 0,
  max_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (scheme_id, modifier_id)
);

ALTER TABLE products ADD COLUMN modifier_scheme_id INTEGER REFERENCES modifier_schemes(id);
ALTER TABLE products ADD COLUMN recipe_text TEXT;
ALTER TABLE products ADD COLUMN recipe_cost_rub INTEGER;
ALTER TABLE products ADD COLUMN recipe_seconds INTEGER;
