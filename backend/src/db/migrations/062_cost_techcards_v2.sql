-- 062: себестоимость v2 — техкарты живут на складе (stock_items), версии, история цен.
-- Совместимость: старые таблицы cost_* остаются как есть, мы их только читаем при переносе.

-- ── 1. Позиция склада становится ингредиентом ────────────────────────────────
ALTER TABLE stock_items ADD COLUMN weight_per_pc_kg REAL;
ALTER TABLE stock_items ADD COLUMN density_kg_l REAL NOT NULL DEFAULT 1;
ALTER TABLE stock_items ADD COLUMN manual_cost_kop INTEGER;
ALTER TABLE stock_items ADD COLUMN nutri_kcal REAL;
ALTER TABLE stock_items ADD COLUMN nutri_protein REAL;
ALTER TABLE stock_items ADD COLUMN nutri_fat REAL;
ALTER TABLE stock_items ADD COLUMN nutri_carbs REAL;
ALTER TABLE stock_items ADD COLUMN allergens TEXT;

-- ── 2. Техкарты, версии, строки ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tech_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'dish' CHECK (kind IN ('dish', 'semi', 'modifier')),
  output_qty REAL NOT NULL DEFAULT 1 CHECK (output_qty > 0),
  output_unit TEXT NOT NULL DEFAULT 'pcs' CHECK (output_unit IN ('kg', 'l', 'pcs', 'g', 'ml')),
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  category_id INTEGER,
  method_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  write_off_mode TEXT NOT NULL DEFAULT 'ingredients'
    CHECK (write_off_mode IN ('ingredients', 'semi', 'semi_then_ingredients', 'none')),
  retail_price_kop INTEGER,
  markup_pct REAL NOT NULL DEFAULT 300,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tech_cards_kind ON tech_cards(kind);
CREATE INDEX IF NOT EXISTS idx_tech_cards_product ON tech_cards(product_id);

CREATE TABLE IF NOT EXISTS tech_card_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES tech_cards(id) ON DELETE CASCADE,
  valid_from INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_tcv_card ON tech_card_versions(card_id, valid_from);

CREATE TABLE IF NOT EXISTS tech_card_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES tech_card_versions(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  stock_item_id INTEGER REFERENCES stock_items(id),
  child_card_id INTEGER REFERENCES tech_cards(id),
  qty_brutto REAL NOT NULL CHECK (qty_brutto > 0),
  loss_cold_pct REAL NOT NULL DEFAULT 0,
  loss_hot_pct REAL NOT NULL DEFAULT 0,
  qty_netto REAL,
  qty_yield REAL,
  line_role TEXT NOT NULL DEFAULT 'base' CHECK (line_role IN ('base', 'optional')),
  CHECK (stock_item_id IS NOT NULL OR child_card_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tcl_version ON tech_card_lines(version_id);
CREATE INDEX IF NOT EXISTS idx_tcl_item ON tech_card_lines(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_tcl_child ON tech_card_lines(child_card_id);

-- ── 3. История цен ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_item_cost_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  cost_kop REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('invoice', 'inventory', 'manual', 'backfill')),
  ref_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cost_history_item ON stock_item_cost_history(stock_item_id, at);

-- ── 4. Перенос справочника: cost_ingredients → stock_items ───────────────────
CREATE TABLE IF NOT EXISTS cost_ingredient_map (
  cost_ingredient_id INTEGER PRIMARY KEY,
  stock_item_id INTEGER NOT NULL
);

INSERT INTO stock_items (name, kind, unit, min_qty, multiplicity, active, notes, manual_cost_kop, created_at, updated_at)
SELECT ci.name, 'raw', ci.unit, 0, 1, ci.active, ci.comment,
       CASE WHEN ci.pack_price_kop IS NOT NULL AND ci.pack_qty > 0
            THEN CAST(ROUND(ci.pack_price_kop * 1.0 / ci.pack_qty) AS INTEGER) END,
       ci.created_at, ci.updated_at
  FROM cost_ingredients ci
 WHERE NOT EXISTS (
   SELECT 1 FROM stock_items si WHERE lower(si.name) = lower(ci.name) AND si.unit = ci.unit
 );

INSERT OR IGNORE INTO cost_ingredient_map (cost_ingredient_id, stock_item_id)
SELECT ci.id,
       (SELECT si.id FROM stock_items si
         WHERE lower(si.name) = lower(ci.name) AND si.unit = ci.unit
         ORDER BY si.id LIMIT 1)
  FROM cost_ingredients ci
 WHERE EXISTS (SELECT 1 FROM stock_items si WHERE lower(si.name) = lower(ci.name) AND si.unit = ci.unit);

-- ── 5. Перенос карт: cost_recipes → tech_cards (id сохраняем) ────────────────
INSERT INTO tech_cards (id, name, kind, output_qty, output_unit, product_id, method_text,
                        status, write_off_mode, retail_price_kop, markup_pct, created_at, updated_at)
SELECT r.id, r.name, 'dish', 1, 'pcs', r.product_id, r.method_text,
       CASE WHEN r.status = 'archived' THEN 'archived' ELSE 'active' END,
       'ingredients', r.retail_price_kop, r.markup_pct, r.created_at, r.updated_at
  FROM cost_recipes r
 WHERE NOT EXISTS (SELECT 1 FROM tech_cards t WHERE t.id = r.id);

INSERT INTO tech_card_versions (card_id, valid_from, note, created_at)
SELECT t.id, t.created_at, 'перенос из cost_recipes', t.created_at
  FROM tech_cards t
 WHERE NOT EXISTS (SELECT 1 FROM tech_card_versions v WHERE v.card_id = t.id);

INSERT INTO tech_card_lines (version_id, sort_order, stock_item_id, qty_brutto, line_role)
SELECT v.id, l.sort_order, m.stock_item_id, l.qty, l.line_role
  FROM cost_recipe_lines l
  JOIN tech_card_versions v ON v.card_id = l.recipe_id
  JOIN cost_ingredient_map m ON m.cost_ingredient_id = l.ingredient_id
 WHERE NOT EXISTS (
   SELECT 1 FROM tech_card_lines x WHERE x.version_id = v.id AND x.sort_order = l.sort_order
 );

-- ── 6. Следы переноса в старых таблицах ─────────────────────────────────────
ALTER TABLE cost_recipes ADD COLUMN migrated_card_id INTEGER;
UPDATE cost_recipes SET migrated_card_id = id WHERE EXISTS (SELECT 1 FROM tech_cards t WHERE t.id = cost_recipes.id);

-- Первый срез истории цен: ручная цена из справочника.
INSERT INTO stock_item_cost_history (stock_item_id, at, cost_kop, source)
SELECT si.id, CAST(strftime('%s','now') AS INTEGER) * 1000, si.manual_cost_kop, 'backfill'
  FROM stock_items si
 WHERE si.manual_cost_kop IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM stock_item_cost_history h WHERE h.stock_item_id = si.id);
