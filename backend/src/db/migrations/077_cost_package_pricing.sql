-- Ingredient prices are entered as package prices and converted only when used.
ALTER TABLE stock_items ADD COLUMN package_qty REAL;
ALTER TABLE stock_items ADD COLUMN package_price_kop INTEGER;
ALTER TABLE stock_items ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK (price_mode IN ('auto', 'manual'));

CREATE TABLE IF NOT EXISTS cost_price_migration_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cost_ingredient_id INTEGER NOT NULL,
  stock_item_id INTEGER NOT NULL,
  old_pack_qty REAL NOT NULL,
  old_pack_price_kop INTEGER NOT NULL,
  existing_manual_cost_kop REAL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- A saved manual unit price remains an intentional override after the upgrade.
UPDATE stock_items SET price_mode='manual' WHERE manual_cost_kop IS NOT NULL;

-- Transfer legacy package prices where no newer source of truth conflicts.
UPDATE stock_items
   SET package_qty = (
         SELECT ci.pack_qty FROM cost_ingredient_map m
         JOIN cost_ingredients ci ON ci.id=m.cost_ingredient_id
         WHERE m.stock_item_id=stock_items.id AND ci.pack_price_kop IS NOT NULL
         ORDER BY ci.id LIMIT 1
       ),
       package_price_kop = (
         SELECT ci.pack_price_kop FROM cost_ingredient_map m
         JOIN cost_ingredients ci ON ci.id=m.cost_ingredient_id
         WHERE m.stock_item_id=stock_items.id AND ci.pack_price_kop IS NOT NULL
         ORDER BY ci.id LIMIT 1
       ),
       manual_cost_kop = NULL,
       price_mode='manual'
 WHERE id IN (
   SELECT m.stock_item_id FROM cost_ingredient_map m
   JOIN cost_ingredients ci ON ci.id=m.cost_ingredient_id
   WHERE ci.pack_price_kop IS NOT NULL AND ci.pack_qty > 0
 )
 AND (
   manual_cost_kop IS NULL
   OR manual_cost_kop = (
     SELECT ROUND(ci.pack_price_kop * 1.0 / ci.pack_qty) FROM cost_ingredient_map m
     JOIN cost_ingredients ci ON ci.id=m.cost_ingredient_id
     WHERE m.stock_item_id=stock_items.id AND ci.pack_price_kop IS NOT NULL
     ORDER BY ci.id LIMIT 1
   )
 )
 AND NOT EXISTS (
   SELECT 1 FROM stock_item_cost_history h
    WHERE h.stock_item_id=stock_items.id AND h.source IN ('invoice', 'inventory', 'manual')
 )
 AND NOT EXISTS (
   SELECT 1 FROM purchase_invoice_lines l
   JOIN purchase_invoices i ON i.id=l.invoice_id
    WHERE l.stock_item_id=stock_items.id AND i.status='posted'
 );

INSERT INTO stock_item_cost_history(stock_item_id, at, cost_kop, source)
SELECT si.id, ci.updated_at, ci.pack_price_kop * 1.0 / ci.pack_qty, 'manual'
  FROM stock_items si
  JOIN cost_ingredient_map m ON m.stock_item_id=si.id
  JOIN cost_ingredients ci ON ci.id=m.cost_ingredient_id
 WHERE si.price_mode='manual'
   AND si.package_price_kop=ci.pack_price_kop
   AND si.package_qty=ci.pack_qty
   AND ci.pack_price_kop IS NOT NULL
   AND ci.pack_qty > 0
   AND NOT EXISTS (
     SELECT 1 FROM stock_item_cost_history h
      WHERE h.stock_item_id=si.id AND h.source='manual'
   );

INSERT INTO cost_price_migration_conflicts (
  cost_ingredient_id, stock_item_id, old_pack_qty, old_pack_price_kop,
  existing_manual_cost_kop, reason, created_at
)
SELECT ci.id, si.id, ci.pack_qty, ci.pack_price_kop, si.manual_cost_kop,
       CASE
         WHEN EXISTS (
           SELECT 1 FROM purchase_invoice_lines l
           JOIN purchase_invoices i ON i.id=l.invoice_id
            WHERE l.stock_item_id=si.id AND i.status='posted'
         ) THEN 'есть проведённые закупки'
         WHEN EXISTS (
           SELECT 1 FROM stock_item_cost_history h
            WHERE h.stock_item_id=si.id AND h.source IN ('invoice', 'inventory', 'manual')
         ) THEN 'есть более новая история цены'
         ELSE 'текущая ручная цена отличается от старой цены упаковки'
       END,
       CAST(strftime('%s','now') AS INTEGER) * 1000
  FROM cost_ingredient_map m
  JOIN cost_ingredients ci ON ci.id=m.cost_ingredient_id
  JOIN stock_items si ON si.id=m.stock_item_id
 WHERE ci.pack_price_kop IS NOT NULL
   AND ci.pack_qty > 0
   AND (
     si.package_qty IS NOT ci.pack_qty
     OR si.package_price_kop IS NOT ci.pack_price_kop
     OR si.price_mode <> 'manual'
   )
   AND NOT (
     (
       si.manual_cost_kop IS NULL
       OR si.manual_cost_kop = ROUND(ci.pack_price_kop * 1.0 / ci.pack_qty)
     )
     AND NOT EXISTS (
       SELECT 1 FROM stock_item_cost_history h
        WHERE h.stock_item_id=si.id AND h.source IN ('invoice', 'inventory', 'manual')
     )
     AND NOT EXISTS (
       SELECT 1 FROM purchase_invoice_lines l
       JOIN purchase_invoices i ON i.id=l.invoice_id
        WHERE l.stock_item_id=si.id AND i.status='posted'
     )
   );
