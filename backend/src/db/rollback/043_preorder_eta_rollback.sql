-- Откат 043: ETA/выдача/баны предзаказа. Выполнять вручную (SQLite ≥ 3.35).
DROP INDEX IF EXISTS idx_preorder_bans_until;
DROP TABLE IF EXISTS preorder_bans;
ALTER TABLE preorders DROP COLUMN ready_by;
ALTER TABLE preorders DROP COLUMN picked_up_at;
ALTER TABLE preorders DROP COLUMN eta_ready_at;
