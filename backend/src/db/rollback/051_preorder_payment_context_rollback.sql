-- Откат 051: контекст оплаты заказа.
DROP INDEX IF EXISTS idx_preorders_fiscal;
ALTER TABLE preorders DROP COLUMN fiscal_document_number;
ALTER TABLE preorders DROP COLUMN paid_amount;
