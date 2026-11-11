-- Откат 064: настройка флага убирается, поведение возвращается к «включено по умолчанию».
DELETE FROM cost_settings WHERE key = 'overhead_enabled';
