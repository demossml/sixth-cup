-- 026: опции схемы (product/zero/modifier). Аддитивно к 025.
-- linked_product_id уже мог появиться в 025 — здесь не дублируем ALTER.

CREATE TABLE IF NOT EXISTS modifier_scheme_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme_id INTEGER NOT NULL REFERENCES modifier_schemes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('product','zero','modifier')),
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  modifier_id INTEGER REFERENCES modifiers(id) ON DELETE CASCADE,
  name TEXT,
  group_key TEXT NOT NULL DEFAULT 'extra',
  is_default INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 0,
  max_count INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mso_scheme ON modifier_scheme_options(scheme_id, sort_order, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mso_default ON modifier_scheme_options(scheme_id, group_key) WHERE is_default=1;
