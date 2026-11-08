-- 051: контекст оплаты заказа (P0-6).
--
-- Раньше mark-paid переводил заказ в `paid` без любых подтверждений: повтор или вызов
-- «на всякий случай» закрывал заказ. Теперь касса может прислать фискальный номер и сумму,
-- и сервер сверяет их с расчётом заказа.

ALTER TABLE preorders ADD COLUMN fiscal_document_number TEXT;
ALTER TABLE preorders ADD COLUMN paid_amount INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_preorders_fiscal
  ON preorders(fiscal_document_number) WHERE fiscal_document_number IS NOT NULL;
