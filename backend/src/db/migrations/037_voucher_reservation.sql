-- Ваучеры на кассе: какие ваучеры гостя отданы кассе вместе с резервом льгот.
-- JSON-массив целых id из vouchers.id. NULL = ваучеры не резервировались (старые строки).
ALTER TABLE loyalty_reservations ADD COLUMN benefit_voucher_ids TEXT;
