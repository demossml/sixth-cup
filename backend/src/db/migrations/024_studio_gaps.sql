-- 024: gaps required by the audit UI (admin "studio"). Additive only: no existing column/table is changed or dropped.

-- Suppliers: legal details shown in the audit supplier drawer
ALTER TABLE suppliers ADD COLUMN legal_name TEXT;
ALTER TABLE suppliers ADD COLUMN legal_type TEXT;       -- Юрлицо | ИП | Самозанятый
ALTER TABLE suppliers ADD COLUMN kpp TEXT;
ALTER TABLE suppliers ADD COLUMN ogrn TEXT;
ALTER TABLE suppliers ADD COLUMN legal_addr TEXT;
ALTER TABLE suppliers ADD COLUMN delivery_addr TEXT;
ALTER TABLE suppliers ADD COLUMN extra_json TEXT;       -- free-form extra fields of the drawer

-- Purchase invoices: delivery receipt flag (audit: «принята» vs only issued)
ALTER TABLE purchase_invoices ADD COLUMN received_at INTEGER;

-- Inventory: zones / categories / recount / author
ALTER TABLE inventory_docs ADD COLUMN author TEXT;
ALTER TABLE inventory_lines ADD COLUMN zone TEXT;
ALTER TABLE inventory_lines ADD COLUMN category TEXT;
ALTER TABLE inventory_lines ADD COLUMN recount INTEGER NOT NULL DEFAULT 0;

-- Recipes: how a product consumes stock (raw | piece | none)
CREATE TABLE IF NOT EXISTS product_recipe_modes (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'raw',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  store_uuid TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | confirmed | sent | partial | closed
  delivery_at INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  qty REAL NOT NULL,
  price_kop INTEGER NOT NULL DEFAULT 0,
  received_qty REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pol_order ON purchase_order_lines(order_id);

CREATE TABLE IF NOT EXISTS supplier_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  store_uuid TEXT,
  basis TEXT NOT NULL DEFAULT 'Брак',   -- Брак | Срок | Пересорт | Прочее
  status TEXT NOT NULL DEFAULT 'draft', -- draft | shipped | posted | cancelled
  notes TEXT,
  posted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_return_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  qty REAL NOT NULL,
  price_kop INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS supplier_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  period_from INTEGER NOT NULL,
  period_to INTEGER NOT NULL,
  their_balance_kop INTEGER,          -- supplier's figure (null until entered)
  status TEXT NOT NULL DEFAULT 'draft', -- draft | agreed | mismatch
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Bank statement rows (stage 2: manual / CSV import; no live bank integration)
CREATE TABLE IF NOT EXISTS bank_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_at INTEGER NOT NULL,
  party TEXT,
  purpose TEXT,
  amount_kop INTEGER NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  invoice_id INTEGER REFERENCES purchase_invoices(id),
  created_at INTEGER NOT NULL
);

-- AI feed: hidden cards (rule-based feed, nothing is stored except the hide)
CREATE TABLE IF NOT EXISTS ai_card_hidden (
  card_key TEXT PRIMARY KEY,
  hidden_until INTEGER NOT NULL
);
