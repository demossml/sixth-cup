-- bank_rows.payment_id: строка выписки, оплаченная этим платежом (идемпотентность повторного POST pay).
ALTER TABLE bank_rows ADD COLUMN payment_id INTEGER REFERENCES purchase_payments(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_rows_payment
  ON bank_rows(payment_id) WHERE payment_id IS NOT NULL;
