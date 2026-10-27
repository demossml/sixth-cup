-- Связь накладной с заказом: приёмка заказа считается по проведённой накладной (D-17, D-18).
ALTER TABLE purchase_invoices ADD COLUMN order_id INTEGER REFERENCES purchase_orders(id);
ALTER TABLE purchase_invoice_lines ADD COLUMN order_line_id INTEGER REFERENCES purchase_order_lines(id);

CREATE INDEX IF NOT EXISTS idx_invoices_order ON purchase_invoices(order_id);
