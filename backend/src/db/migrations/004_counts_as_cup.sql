ALTER TABLE products ADD COLUMN counts_as_cup INTEGER NOT NULL DEFAULT 0;
UPDATE products SET counts_as_cup = 1
WHERE icon = 'Coffee'
   OR lower(name) LIKE '%латте%'
   OR lower(name) LIKE '%капуч%'
   OR lower(name) LIKE '%американо%'
   OR lower(name) LIKE '%раф%'
   OR (lower(name) LIKE '%кофе%' AND lower(name) NOT LIKE '%печень%');
