-- Stock, batches, norms, suppliers, purchase invoices, inventory docs.
-- Per design-project (audit): balances only via documents; FEFO batches; invoice posts stock + debt.

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  inn TEXT,
  contact TEXT,
  phone TEXT,
  email TEXT,
  bank_details TEXT,
  payment_delay_days INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT,
  kind TEXT NOT NULL DEFAULT 'raw', -- raw | unit
  unit TEXT NOT NULL DEFAULT 'kg',  -- kg | l | pcs | g | ml
  min_qty REAL NOT NULL DEFAULT 0,
  multiplicity REAL NOT NULL DEFAULT 1,
  shelf_life_days INTEGER,
  default_supplier_id INTEGER REFERENCES suppliers(id),
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_items_active ON stock_items(active);
CREATE INDEX IF NOT EXISTS idx_stock_items_kind ON stock_items(kind);

-- Norms: sale product consumes stock item qty (e.g. 18g coffee per cup)
CREATE TABLE IF NOT EXISTS product_stock_norms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  qty REAL NOT NULL,
  UNIQUE(product_id, stock_item_id)
);
CREATE INDEX IF NOT EXISTS idx_norms_product ON product_stock_norms(product_id);

CREATE TABLE IF NOT EXISTS stock_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  store_uuid TEXT, -- Evotor store or null = network
  lot_code TEXT,
  qty_in REAL NOT NULL DEFAULT 0,
  qty_left REAL NOT NULL DEFAULT 0,
  unit_cost_kop INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER, -- unix ms, null = no expiry
  supplier_id INTEGER REFERENCES suppliers(id),
  source_type TEXT, -- purchase | inventory | adjustment
  source_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batches_item ON stock_batches(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_batches_expires ON stock_batches(expires_at);
CREATE INDEX IF NOT EXISTS idx_batches_left ON stock_batches(qty_left);

-- Ledger: expected balance = sum of movements
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  batch_id INTEGER REFERENCES stock_batches(id),
  store_uuid TEXT,
  qty REAL NOT NULL, -- + in, - out
  kind TEXT NOT NULL, -- purchase_in | sale_out | inventory_adj | write_off | return
  doc_type TEXT,
  doc_id INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movements_item ON stock_movements(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_movements_doc ON stock_movements(doc_type, doc_id);

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  store_uuid TEXT,
  number TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | posted | cancelled
  total_kop INTEGER NOT NULL DEFAULT 0,
  paid_kop INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER,
  posted_at INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON purchase_invoices(status);

CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  qty REAL NOT NULL,
  unit_cost_kop INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  lot_code TEXT,
  batch_id INTEGER REFERENCES stock_batches(id)
);
CREATE INDEX IF NOT EXISTS idx_inv_lines_invoice ON purchase_invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS purchase_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  amount_kop INTEGER NOT NULL,
  paid_at INTEGER NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_payment_alloc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES purchase_payments(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id),
  amount_kop INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_invoice ON purchase_payment_alloc(invoice_id);

CREATE TABLE IF NOT EXISTS inventory_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_uuid TEXT,
  kind TEXT NOT NULL DEFAULT 'partial', -- full | partial
  status TEXT NOT NULL DEFAULT 'draft', -- draft | counting | review | posted | cancelled
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  posted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invdocs_status ON inventory_docs(status);

CREATE TABLE IF NOT EXISTS inventory_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES inventory_docs(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  book_qty REAL, -- expected at snapshot (manager view)
  fact_qty REAL, -- counted
  unit_cost_kop INTEGER NOT NULL DEFAULT 0,
  UNIQUE(doc_id, stock_item_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_lines_doc ON inventory_lines(doc_id);
