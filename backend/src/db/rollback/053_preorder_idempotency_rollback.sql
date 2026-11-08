-- Откат 053: ключи идемпотентности и уникальность активного заказа.
DROP INDEX IF EXISTS idx_preorders_one_active_per_guest;
DROP INDEX IF EXISTS idx_idempotency_created;
DROP TABLE IF EXISTS idempotency_keys;
