-- SQLite не умеет DROP COLUMN до 3.35; на всякий случай оставляем колонку и обнуляем версию.
UPDATE menu_layouts SET rev = 1;
