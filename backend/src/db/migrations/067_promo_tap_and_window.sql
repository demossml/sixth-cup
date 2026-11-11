-- CON-1: акция на главной получает действие по тапу и окно показа по времени суток.
--
-- tap_action: что делать при тапе по карточке
--   'modal'   — открыть описание акции в модальном окне (по умолчанию);
--   'product' — перейти к товару (product_id);
--   'menu'    — открыть меню.
--
-- time_from / time_to — границы показа в минутах от полуночи по времени телефона
-- (420 = 07:00). NULL в обоих = показывать всегда. Если time_to <= time_from,
-- окно считается переходящим через полночь (например, 22:00–02:00).
ALTER TABLE promos ADD COLUMN tap_action TEXT NOT NULL DEFAULT 'modal';
ALTER TABLE promos ADD COLUMN time_from INTEGER;
ALTER TABLE promos ADD COLUMN time_to INTEGER;

-- Акции, созданные до этого изменения и ведущие на товар, сохраняют привычное поведение.
UPDATE promos SET tap_action = 'product' WHERE product_id IS NOT NULL;
