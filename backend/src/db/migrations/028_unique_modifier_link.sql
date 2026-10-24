-- A2: one product per modifier link.
-- Duplicates can appear because syncModifierProduct used to adopt products by name.
-- Keep the oldest modifier per product, detach the rest: they will get their own
-- product inside «Добавки» on the next backfill (retail products are never touched).
UPDATE modifiers
SET linked_product_id = NULL
WHERE linked_product_id IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id) FROM modifiers WHERE linked_product_id IS NOT NULL GROUP BY linked_product_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_linked_product
  ON modifiers(linked_product_id)
  WHERE linked_product_id IS NOT NULL;
