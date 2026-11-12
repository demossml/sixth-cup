-- Откат 069: убираем короткое описание и условия.
ALTER TABLE promos DROP COLUMN subtitle;
ALTER TABLE promos DROP COLUMN terms;
