-- Откат 045: бонус гостя в предзаказе. Выполнять вручную (SQLite ≥ 3.35).
-- ВНИМАНИЕ: резервы лояльности, созданные под заказы, освободите вручную (status='EXPIRED').
DROP INDEX IF EXISTS idx_preorders_reservation;
ALTER TABLE preorders DROP COLUMN quoted_at;
ALTER TABLE preorders DROP COLUMN quote_total;
ALTER TABLE preorders DROP COLUMN reservation_id;
ALTER TABLE preorders DROP COLUMN benefit_json;
