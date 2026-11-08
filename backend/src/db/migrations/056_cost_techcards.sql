-- 056: себестоимость / техкарты (калькуляция, отдельно от складских движений)
CREATE TABLE IF NOT EXISTS cost_ingredient_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cost_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES cost_ingredient_categories(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'pcs')),
  pack_qty REAL NOT NULL CHECK (pack_qty > 0),
  pack_price_kop INTEGER,
  comment TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_ingredients_cat ON cost_ingredients(category_id);
CREATE INDEX IF NOT EXISTS idx_cost_ingredients_active ON cost_ingredients(active);

CREATE TABLE IF NOT EXISTS cost_recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  output_label TEXT,
  product_id INTEGER,
  markup_pct REAL NOT NULL DEFAULT 300,
  retail_price_kop INTEGER,
  method_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_recipe_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES cost_recipes(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES cost_ingredients(id),
  qty REAL NOT NULL CHECK (qty > 0),
  line_role TEXT NOT NULL DEFAULT 'base' CHECK (line_role IN ('base', 'optional')),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cost_recipe_lines_recipe ON cost_recipe_lines(recipe_id);
CREATE INDEX IF NOT EXISTS idx_cost_recipe_lines_ing ON cost_recipe_lines(ingredient_id);

INSERT OR IGNORE INTO cost_ingredient_categories (id, name, sort_order, is_system) VALUES
  (1, 'Кофе и зерно', 10, 1),
  (2, 'Молоко и альтернативы', 20, 1),
  (3, 'Сиропы и топпинги', 30, 1),
  (4, 'Посуда', 40, 1),
  (5, 'Еда / заготовки', 50, 1),
  (6, 'Специи и украшения', 60, 1),
  (7, 'Прочее', 100, 1);
