-- Откат 067: убираем действие по тапу и окно показа.
ALTER TABLE promos DROP COLUMN tap_action;
ALTER TABLE promos DROP COLUMN time_from;
ALTER TABLE promos DROP COLUMN time_to;
