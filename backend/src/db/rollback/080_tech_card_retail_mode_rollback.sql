-- Откат 080: убираем режим цены, возвращаемся к прежнему приоритету каталога.
ALTER TABLE tech_cards DROP COLUMN retail_mode;
