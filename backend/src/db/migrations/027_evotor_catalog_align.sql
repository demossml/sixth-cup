-- 027: Align catalog with Evotor Cloud inventory model (1:1).
--
-- Evotor required shape for every catalog item:
--   uuid | name | group (bool) | parentUuid (nullable) | type | price | measure | tax | allowToSell
--
-- Local mapping:
--   products.is_group          ↔ group
--   products.parent_product_id ↔ local parent group (resolved to parentUuid per store via product_store_links)
--   product_store_links.evotor_uuid ↔ uuid (per store)
--
-- Addons (modifiers) converge onto ordinary products:
--   each modifier gets a linked product in category «Добавки»
--   that product gets parent_product_id → group product named by group_key (Сиропы / Молоко / …)
--
-- Additive only. No drops. Existing APIs keep working.

-- 1) Evotor-aligned columns on products
-- is_group: 1 = folder/group in Evotor, 0 = sellable product
-- parent_product_id: local FK to the group product (NULL = root)

ALTER TABLE products ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN parent_product_id INTEGER REFERENCES products(id);

CREATE INDEX IF NOT EXISTS idx_products_parent ON products(parent_product_id);
CREATE INDEX IF NOT EXISTS idx_products_is_group ON products(is_group);

-- 2) Ensure category «Добавки» exists
INSERT INTO categories(name, sort_order, available, created_at, updated_at)
SELECT 'Добавки', 90, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (
  SELECT 1 FROM categories
  WHERE lower(replace(replace(name,'Ё','е'),'ё','е')) LIKE '%добавк%'
);

-- 3) Ensure every modifier has a linked product (proxy SKU for Evotor uuid)
--    Reuses existing same-name product in «Добавки» when possible; otherwise creates one.

UPDATE modifiers
SET linked_product_id = (
  SELECT p.id FROM products p
  JOIN categories c ON c.id = p.category_id
  WHERE lower(replace(replace(p.name,'Ё','е'),'ё','е')) = lower(replace(replace(modifiers.name,'Ё','е'),'ё','е'))
    AND lower(replace(replace(c.name,'Ё','е'),'ё','е')) LIKE '%добавк%'
  ORDER BY p.id
  LIMIT 1
)
WHERE linked_product_id IS NULL
  AND EXISTS (
    SELECT 1 FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE lower(replace(replace(p.name,'Ё','е'),'ё','е')) = lower(replace(replace(modifiers.name,'Ё','е'),'ё','е'))
      AND lower(replace(replace(c.name,'Ё','е'),'ё','е')) LIKE '%добавк%'
  );

-- Create missing proxy products for modifiers still without linked_product_id
INSERT INTO products(
  name, price, icon, available, category_id, sort_order,
  created_at, updated_at, counts_as_cup, free_eligible,
  tax, measure, cost_price_kopecks, catalog_source, is_group
)
SELECT
  m.name,
  m.price,
  'Coffee',
  CASE WHEN m.available = 1 THEN 1 ELSE 0 END,
  (SELECT id FROM categories WHERE lower(replace(replace(name,'Ё','е'),'ё','е')) LIKE '%добавк%' ORDER BY id LIMIT 1),
  0,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  0,
  0,
  'NO_VAT',
  'шт',
  0,
  'SIXTH_CUP',
  0
FROM modifiers m
WHERE m.linked_product_id IS NULL;

UPDATE modifiers
SET linked_product_id = (
  SELECT p.id FROM products p
  WHERE lower(replace(replace(p.name,'Ё','е'),'ё','е')) = lower(replace(replace(modifiers.name,'Ё','е'),'ё','е'))
    AND p.counts_as_cup = 0
    AND p.is_group = 0
  ORDER BY p.id DESC
  LIMIT 1
)
WHERE linked_product_id IS NULL;

-- Keep proxy product fields in sync with modifier
UPDATE products
SET
  price = (SELECT m.price FROM modifiers m WHERE m.linked_product_id = products.id LIMIT 1),
  available = (SELECT CASE WHEN m.available = 1 THEN 1 ELSE 0 END FROM modifiers m WHERE m.linked_product_id = products.id LIMIT 1),
  counts_as_cup = 0,
  free_eligible = 0,
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id IN (SELECT linked_product_id FROM modifiers WHERE linked_product_id IS NOT NULL);

-- 4) Create group products for each used group_key (Evotor parent folders)
--    Canonical Russian names for UI + Evotor.

INSERT INTO products(
  name, price, icon, available, category_id, sort_order,
  created_at, updated_at, counts_as_cup, free_eligible,
  tax, measure, cost_price_kopecks, catalog_source, is_group
)
SELECT
  CASE
    WHEN lower(m.group_key) IN ('milk', 'молоко') THEN 'Молоко'
    WHEN lower(m.group_key) IN ('syrup', 'сироп') THEN 'Сиропы'
    WHEN lower(m.group_key) IN ('sugar', 'сахар') THEN 'Сахар'
    ELSE 'Добавки'
  END AS gname,
  0,
  'Folder',
  1,
  (SELECT id FROM categories WHERE lower(replace(replace(name,'Ё','е'),'ё','е')) LIKE '%добавк%' ORDER BY id LIMIT 1),
  CASE
    WHEN lower(m.group_key) IN ('milk', 'молоко') THEN 10
    WHEN lower(m.group_key) IN ('syrup', 'сироп') THEN 20
    WHEN lower(m.group_key) IN ('sugar', 'сахар') THEN 30
    ELSE 40
  END,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  0,
  0,
  'NO_VAT',
  'шт',
  0,
  'SIXTH_CUP',
  1
FROM (SELECT DISTINCT group_key FROM modifiers) m
WHERE NOT EXISTS (
  SELECT 1 FROM products p
  WHERE p.is_group = 1
    AND p.name = CASE
      WHEN lower(m.group_key) IN ('milk', 'молоко') THEN 'Молоко'
      WHEN lower(m.group_key) IN ('syrup', 'сироп') THEN 'Сиропы'
      WHEN lower(m.group_key) IN ('sugar', 'сахар') THEN 'Сахар'
      ELSE 'Добавки'
    END
);

-- 5) Point addon products at their group (parent_product_id)
UPDATE products
SET parent_product_id = (
  SELECT g.id FROM products g
  JOIN modifiers m ON m.linked_product_id = products.id
  WHERE g.is_group = 1
    AND g.name = CASE
      WHEN lower(COALESCE(m.group_key,'')) IN ('milk', 'молоко') THEN 'Молоко'
      WHEN lower(COALESCE(m.group_key,'')) IN ('syrup', 'сироп') THEN 'Сиропы'
      WHEN lower(COALESCE(m.group_key,'')) IN ('sugar', 'сахар') THEN 'Сахар'
      ELSE 'Добавки'
    END
  LIMIT 1
)
WHERE id IN (SELECT linked_product_id FROM modifiers WHERE linked_product_id IS NOT NULL)
  AND parent_product_id IS NULL;

-- 6) Helper view: Evotor-shaped row for a product in a store
--    (uuid + parentUuid resolved from product_store_links)
DROP VIEW IF EXISTS v_evotor_catalog_item;
CREATE VIEW v_evotor_catalog_item AS
SELECT
  p.id                                              AS local_id,
  l.store_uuid                                      AS store_uuid,
  l.evotor_uuid                                     AS uuid,
  p.name                                            AS name,
  CASE WHEN p.is_group = 1 THEN 1 ELSE 0 END         AS "group",
  pl.evotor_uuid                                    AS parent_uuid,
  CASE WHEN p.is_group = 1 THEN NULL ELSE COALESCE(p.tax, 'NO_VAT') END AS tax,
  CASE WHEN p.is_group = 1 THEN NULL ELSE COALESCE(p.measure, 'шт') END AS measure_name,
  CASE WHEN p.is_group = 1 THEN NULL ELSE p.price END AS price,
  CASE WHEN p.is_group = 1 THEN NULL ELSE CASE WHEN p.available = 1 THEN 1 ELSE 0 END END AS allow_to_sell,
  CASE WHEN p.is_group = 1 THEN NULL ELSE 'NORMAL' END AS type,
  NULL                                                AS article_number,
  p.parent_product_id                               AS parent_product_id,
  p.is_group                                        AS is_group,
  p.catalog_source                                  AS catalog_source
FROM products p
LEFT JOIN product_store_links l
  ON l.product_id = p.id
LEFT JOIN product_store_links pl
  ON pl.product_id = p.parent_product_id
 AND pl.store_uuid = l.store_uuid;

-- 7) Notes for operators (no-op select so migration stays pure SQL)
-- After this migration:
--   * Push groups first, then children (ProductPushService must order by is_group DESC).
--   * toEvotorProduct must send group + parentUuid from v_evotor_catalog_item / links.
--   * modifiers remain as a thin admin UX layer; identity in Evotor is always the linked product uuid.
