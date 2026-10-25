-- 029: канон схемы — modifier_scheme_options.
-- price_override переносим из легаси modifier_scheme_items, чтобы конверсия items→options
-- не меняла цену позиции. Поле аддитивное: старые APK его не видят.
ALTER TABLE modifier_scheme_options ADD COLUMN price_override INTEGER;
