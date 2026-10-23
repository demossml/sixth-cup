-- Addon schemes: product_id / zero_option / is_default; modifiers.linked_product_id
-- Rebuild modifier_scheme_items (old PK was scheme_id+modifier_id only).

ALTER TABLE modifiers ADD COLUMN linked_product_id INTEGER REFERENCES products(id);

CREATE TABLE IF NOT EXISTS modifier_scheme_items_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme_id INTEGER NOT NULL REFERENCES modifier_schemes(id) ON DELETE CASCADE,
  modifier_id INTEGER REFERENCES modifiers(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  group_key TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  max_count INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  zero_option INTEGER NOT NULL DEFAULT 0,
  price_override INTEGER,
  name_override TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO modifier_scheme_items_v2(
  scheme_id, modifier_id, product_id, group_key, required, max_count,
  is_default, zero_option, price_override, name_override, sort_order
)
SELECT
  i.scheme_id,
  i.modifier_id,
  NULL,
  NULL,
  i.required,
  i.max_count,
  0,
  0,
  NULL,
  NULL,
  0
FROM modifier_scheme_items i;

DROP TABLE modifier_scheme_items;
ALTER TABLE modifier_scheme_items_v2 RENAME TO modifier_scheme_items;

CREATE INDEX IF NOT EXISTS idx_msi_scheme ON modifier_scheme_items(scheme_id);
CREATE INDEX IF NOT EXISTS idx_msi_product ON modifier_scheme_items(product_id);
CREATE INDEX IF NOT EXISTS idx_mod_linked_product ON modifiers(linked_product_id);
