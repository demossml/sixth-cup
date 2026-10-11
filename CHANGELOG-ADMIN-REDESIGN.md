# Редизайн админки (фазы 0–3)

Основано на плане редизайна и ответах владельца. Android-приложение (APK), клиентское PWA и логика начисления не менялись.

## Что изменилось в поведении

- **`POST /api/admin/reset` в production отключён по умолчанию.** Включается только `ADMIN_ALLOW_RESET=1`. В разработке работает как раньше. UI показывает кнопки сброса только если `/api/admin/meta` вернул `resetAllowed: true`.
- Сравнение `X-Admin-Token` — через `timingSafeEqual`.
- Все изменяющие запросы админки пишутся в журнал `admin_audit` (кто/что/было→стало; секреты вырезаются). Таблица создаётся кодом при старте (`CREATE TABLE IF NOT EXISTS`), миграции не нужны.
- `GET /products`: в `evotorLinks` добавлено поле `enabled`.
- `GET /overview`: «последний опрос» считается как `MAX(last_fast_at)`.

## Новые эндпоинты (`/api/admin`)

`/meta`, `/evotor/health` (зелёный < 5 мин, жёлтый 5–30, красный > 30 или ERROR), `/dashboard`, `/operations` (+`/operations.csv`, `/operations/:store/:doc`, курсорная пагинация), `/customers`, `/customers/:id`, `/customers/:id/phone` (телефон только по явному запросу, пишется в журнал), `/customers/:id/vouchers`, `/voucher-templates`, `/vouchers/grant-all/preview`, `PATCH /products/:id`, `POST /products/bulk` (с `dryRun`), `/products.csv`, `/audit`.

## Фронтенд админки

Хеш-маршрутизация (`#/`, `#/operations`, …), без новых зависимостей. Разделы: Сегодня, Операции, Клиенты (+карточка), Меню (товары, группы, добавки, схемы), Касса, Маркетинг, Система (логи, журнал действий, опасная зона). На телефоне — нижняя навигация и карточки вместо таблиц. Прежняя админка доступна по `#/legacy`.

Телефон клиента нигде не показывается в списках (гостевая модель: идентификатор — карта).

## Настройки

`ADMIN_ALLOW_RESET`, `EVOTOR_HEALTH_WARN_MIN`, `EVOTOR_HEALTH_CRIT_MIN` (см. `DEPLOYMENT.md`).

## Проверки

`npm run typecheck`, `npm run build`, `npm run test -w backend` (88 тестов, из них 18 на админку и 5 на чистые функции UI).

## Не делалось

Роли и права (фаза 4), повторная обработка SELL из UI, организации/магазины/устройства (точки берутся только из Эвотор).
