-- 048: часы работы точки по дням недели.
--
-- hours_json — массив 7 элементов (0 = понедельник … 6 = воскресенье):
--   [{ "open": "08:00", "close": "21:00" } | null, ...]
-- null — выходной. Если hours_json не задан — используем старые open_time/close_time (обратная совместимость).

ALTER TABLE stores ADD COLUMN hours_json TEXT;
