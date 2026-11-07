# Схемы обязательного выбора без цены («с корицей / без корицы»)

Отдельное назначение товара, как схема молока, но **без цены и без товара Эвотор**.

## Модель
- `choice_schemes(id, name, title, active)` — `title` («Корица», ≤24 знака) показывается кассиру и печатается на чеке.
- `choice_scheme_options(id, scheme_id, label ≤24, is_default, sort_order, active)`.
- `products.choice_scheme_id` — назначение **на каждый размер** (как молоко). Миграция `041_choice_schemes.sql` только добавляет таблицы/колонку; откат — `rollback/041_choice_schemes_rollback.sql`.
- Правила: ≥2 активных варианта, подписи уникальны без учёта регистра, ≤1 вариант по умолчанию.
- Выключенная схема = «схемы нет»: блока на кассе нет, в каталоге `choiceSchemeId = null`.

## API
- Админка: `GET/POST /api/admin/choice-schemes`, `DELETE /choice-schemes/:id` (нельзя, пока назначена), `POST /choice-schemes/apply {schemeId|null, groupIds?, productIds?, dryRun}` — массовое назначение/снятие с предпросмотром. Запись для marketer/manager запрещена.
- `POST /products`, `POST /product-groups`: поле `choiceSchemeId` (`undefined` — не трогать, `null` — снять).
- Касса: `GET /api/devices/products/:id/configuration` получает **добавочный** ключ
  `choices: null | { required: true, byProductId: { "<pid>": { schemeId|null, title, options:[{id,label,isDefault}], error?: "invalid_scheme" } } }`.
  `schemaVersion` остаётся **1**. Нет схемы — `null` / `schemeId:null`. Цен и uuid в `choices` нет.
- `GET /api/devices/catalog`: у товара добавлено `choiceSchemeId` (внутри `config` ключ **не** добавляется).
- Готовность: схема с <2 активных вариантов даёт `choice_scheme_empty` (kind `choice`) и `configErrors: ["choice_scheme_invalid"]`.

## Чек
0 ₽ в фискальный чек не пробивается. Выбор печатается строками PrintExtra (`ЗАКАЗ № …` → строки выбора → лояльность). В ОФД/электронном чеке выбора нет — это нормально.

## Порядок выкладки
1. backend + админка; 2. APK 159 на все кассы; 3. только потом создавать и назначать схему «Корица».
