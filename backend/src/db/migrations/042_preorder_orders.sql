-- Pre-order: guest PWA → cashier resolve flow
CREATE TABLE IF NOT EXISTS preorders (
  id TEXT PRIMARY KEY,
  short_code TEXT NOT NULL,
  store_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  card_id TEXT,
  guest_user_id INTEGER,
  estimate_total INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  cooking_at INTEGER,
  ready_at INTEGER,
  paid_at INTEGER,
  rejected_at INTEGER,
  reject_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_preorders_store_status ON preorders(store_id, status);
CREATE INDEX IF NOT EXISTS idx_preorders_short ON preorders(store_id, short_code);
CREATE INDEX IF NOT EXISTS idx_preorders_expires ON preorders(expires_at);

CREATE TABLE IF NOT EXISTS preorder_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES preorders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  evotor_product_uuid TEXT,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  volume_label TEXT,
  config_text TEXT NOT NULL DEFAULT '',
  unit_price_estimate INTEGER NOT NULL,
  position INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_preorder_items_order ON preorder_items(order_id);

CREATE TABLE IF NOT EXISTS preorder_item_modifiers (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL REFERENCES preorder_items(id) ON DELETE CASCADE,
  group_key TEXT NOT NULL,
  modifier_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price_estimate INTEGER NOT NULL DEFAULT 0,
  send_to_receipt INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_preorder_mods_item ON preorder_item_modifiers(order_item_id);
