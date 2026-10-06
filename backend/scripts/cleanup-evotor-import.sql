UPDATE evotor_stores SET sync_enabled=0;
-- then: UPDATE evotor_stores SET sync_enabled=1 WHERE store_uuid='YOUR-UUID';
DELETE FROM product_store_links WHERE product_id IN (SELECT id FROM products WHERE catalog_source='EVOTOR_IMPORT');
DELETE FROM evotor_products WHERE product_id IN (SELECT id FROM products WHERE catalog_source='EVOTOR_IMPORT');
DELETE FROM products WHERE catalog_source='EVOTOR_IMPORT';
DELETE FROM evotor_outbox WHERE store_uuid IN (SELECT store_uuid FROM evotor_stores WHERE COALESCE(sync_enabled,0)=0);
