-- 045: бонус гостя в предзаказе (подарок / ваучер / кэшбэк) + фиксированная сумма.
--
-- Гость выбирает одно правило в корзине. Сервер считает сумму (quote), создаёт резерв лояльности
-- и хранит его вместе с заказом; касса применяет бонус по sc.ord — без собственных скидок.
--
-- Аддитивно: существующие заказы остаются с benefit_json = NULL.

ALTER TABLE preorders ADD COLUMN benefit_json TEXT;
ALTER TABLE preorders ADD COLUMN reservation_id TEXT;
ALTER TABLE preorders ADD COLUMN quote_total INTEGER;
ALTER TABLE preorders ADD COLUMN quoted_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_preorders_reservation ON preorders(reservation_id);
