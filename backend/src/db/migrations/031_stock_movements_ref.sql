-- stock_movements.ref_doc_id: документ-основание для возвратов (PAYBACK → базовый чек).
-- Нужен, чтобы считать, сколько уже возвращено по каждой продаже (D-08, D-10).
ALTER TABLE stock_movements ADD COLUMN ref_doc_id TEXT;

CREATE INDEX IF NOT EXISTS idx_movements_ref ON stock_movements(doc_type, ref_doc_id);
