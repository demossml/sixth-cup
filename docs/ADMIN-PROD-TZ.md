> HISTORICAL NOTES: the current admin/Evotor contract is documented in `README.md` and `docs/PRODUCT-SYNC-EVOTOR.md`.

# Admin prod (реализовано по ТЗ)

- `POST /api/admin/reset` mode: loyalty | catalog | full
- Production: `seedIfEmpty()` no-op (нет демо-точек/DEMO-кассы)
- DELETE organizations (если нет точек), stores (если нет активных касс), products
- НДС в UI: 0 / 10 / 20 / 22
- Кассы: подсказка enroll без пароля
- Споры → «Конфликты» + пояснение
- Promo PATCH для редактирования

После деплоя на mini: при необходимости сброс лояльности из Обзора.
