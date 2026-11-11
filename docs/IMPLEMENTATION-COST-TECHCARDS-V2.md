# Внедрение: «Себестоимость + техкарта» (F1–F8)

Дата: 2026-11-11. План: `docs/PLAN-COST-TECHCARDS.md`. Исследование: `docs/RESEARCH-COST-TECHCARDS-2026-11-11.md`.
Статус: **все фазы выполнены**, регресса нет.

## Что сделано по фазам

| Фаза | Результат | Файлы |
|---|---|---|
| **F1. Модель** | миграция `062`: `stock_items` (+`weight_per_pc_kg`, `density_kg_l`, `manual_cost_kop`, КБЖУ, `allergens`), таблицы `tech_cards`, `tech_card_versions`, `tech_card_lines`, `stock_item_cost_history`, карта переноса `cost_ingredient_map`; перенос `cost_ingredients → stock_items` и `cost_recipes → tech_cards` с сохранением id; `cost_recipes.migrated_card_id` | `backend/src/db/migrations/062_cost_techcards_v2.sql`, `db/rollback/062_…_rollback.sql` |
| **F2. Движок** | чистые функции: конверсии единиц (кг/л/шт/г/мл, вес штуки, плотность), двунаправленный выход/потери, средневзвешенная цена с фолбэками, себестоимость строки и карты, норма закладки, фудкост/маржа, поиск циклов, проекция норм, бейджи проблем | `backend/src/modules/admin/costCalc.ts` (+ 24 теста) |
| **F3. API** | `/cost/tech-cards` (список/карта/создание/правка/удаление), `/versions` (новая версия с даты, с копией состава), `/publish` (проекция на склад), `/usage` (вхождение), `/cost/items`, `/cost/items/:id/price-history`, `/cost/insights`, `/cost/overview` | `backend/src/modules/admin/costTechCards.ts` |
| **F4. Цены** | средневзвешенная из проведённых накладных в окне «последняя инвентаризация или 90 дней»; фолбэки: последняя известная → ручная → «нет цены»; история пишется при проведении накладной и при ручном изменении | `costTechCards.ts`, `stock.ts` (post-хук) |
| **F5. UI** | новые вкладки «Техкарты» и «Сигналы»; редактор карты с двунаправленным вводом (брутто/потери/нетто/выход), привязкой к товару кассы, версиями, вхождением, публикацией; массовая замена ингредиента; ручная цена в «Сигналах» | `components/cost/TechCardsTab.tsx`, `components/cost/SignalsTab.tsx`, `lib/costApi.ts`, `lib/costMath.ts`, `pages/Cost.tsx`, `lib/costTabs.ts` |
| **F6. Массовые операции** | замена ингредиента с коэффициентом (все карты или выбранные) и массовая правка % потерь — с пересчётом проекции | `costTechCards.ts` (+ UI-шита «Заменить ингредиент») |
| **F7. Склад и касса** | публикация карты пишет `product_stock_norms`, `product_recipe_modes` и `products.cost_price_kopecks` → цена уезжает в Эвотор существующим синком; `/stock/recipes` читает ту же проекцию | `costTechCards.ts` (`projectCard`) |
| **F8. Приёмка** | сквозные тесты + живой прогон в браузере (см. ниже) | этот файл |

## API (кратко)

```
GET    /api/admin/cost/tech-cards?q=&kind=&problems=1
GET    /api/admin/cost/tech-cards/:id[?versionId=]
POST   /api/admin/cost/tech-cards
PUT    /api/admin/cost/tech-cards/:id[?versionId=]
DELETE /api/admin/cost/tech-cards/:id
POST   /api/admin/cost/tech-cards/:id/versions    { validFrom?, note? }
POST   /api/admin/cost/tech-cards/:id/publish
GET    /api/admin/cost/tech-cards/:id/usage
GET    /api/admin/cost/items?q=&problems=1
PUT    /api/admin/cost/items/:id                  { manualCostRub?, weightPerPcKg?, densityKgL?, notes? }
GET    /api/admin/cost/items/:id/price-history
GET    /api/admin/cost/insights
GET    /api/admin/cost/overview
POST   /api/admin/cost/bulk/replace-ingredient    { fromStockItemId, toStockItemId, factor?, cardIds? }
POST   /api/admin/cost/bulk/loss-pct              { cardIds, stockItemId?, lossColdPct, lossHotPct? }
```

Старые `/cost/ingredients`, `/cost/recipes`, `/cost/summary` **не тронуты** — работают как раньше,
поэтому ПВА, каталог и текущие экраны не ломаются.

## Живая проверка (dev, Chromium)

1. «Сигналы»: у позиции «Кофе-тест» не было цены → ручная цена 2000 ₽/кг сохранена, бейдж «нет цены» ушёл.
2. «Техкарты» → «Новая карта»: «QA: капучино техкарта», ингредиент 0,018 кг → строка **36,00 ₽**,
   себестоимость порции **36,00 ₽**, «все цены есть».
3. Привязка «Товар кассы» → «Опубликовать» → тост «Карта опубликована: нормы ушли на склад (1)».
4. В БД: `product_stock_norms` = `{product 42, item 2, qty 0.018}`, `product_recipe_modes.mode='raw'`,
   `products.cost_price_kopecks = 3600`.
5. `GET /stock/recipes` показывает ту же норму — склад и себестоимость больше не расходятся.
6. Цена продажи 144 ₽ (авто по наценке 300 %) → фудкост 25,0 %, маржа 108,00 ₽.
7. Тестовые данные удалены: карта, проекция, ручная цена, `cost_price` товара возвращены.

## F9 (продолжение): вывод старых вкладок и импорт в v2

Отчёт выше фиксировал долг: «Дозаполнить», «Старые рецепты» и «Сводка» жили на модели `cost_*`.
Долг закрыт:

| Что | Было | Стало |
|---|---|---|
| Импорт техкарт | `/cost/import/techcard-*` → `cost_ingredients` + `cost_recipes` | `/cost/import/techcards-*` → `stock_items` + `tech_cards` (черновики), старые таблицы не заполняются |
| ИИ-прайс | `/cost/ingredients/bulk` | `/cost/import/items-bulk` → позиции склада с ценой за единицу |
| «Дозаполнить» | `cost_ingredients`, категории, фасовки | «Ингредиенты»: `/cost/items`, ручная цена, вес штуки, история цены |
| «Рецепты» | `cost_recipes` | «Техкарты» (та же вкладка, что в v2), старая вкладка убрана |
| «Сводка» | `/cost/summary` по старым рецептам | `/cost/overview`: средний фудкост, маржа, замечания, сортировка по фудкосту |
| Ссылки | `?focus=missing` → «Дозаполнить» | `?focus=missing|items|fill` → «Ингредиенты», `recipes` → «Техкарты», `signals`/`summary` — как есть |

Старые эндпоинты `/cost/ingredients|recipes|summary|import/techcard-*` **оставлены** в API
(совместимость для внешних вызовов), но страница их больше не использует.

Живая проверка: «Загрузить» → «Вставить текст» → `ЛАТТЕ ИМПОРТ QA` → баннер
«Рецептов: 1 · новых карт: 1 · строк: 3 · новых ингредиентов: 3 · без цены: 3», карта появилась
черновиком с бейджами «себестоимость не посчитана / у части сырья нет цены / не задана цена продажи»;
«Сводка» показала её в таблице с теми же замечаниями. Тестовые данные удалены.

## Проверки

```
npm run typecheck              # 3/3
npm run test -w backend        # 897 тестов (было 859): +24 движок, +12 API/импорт, +2 миграция
npm run test -w frontend-admin # 238 тестов (было 228): +9 математика карты, +1 правило вкладок
npm run build                  # 3/3
```

## Что осталось за рамками v1 (осознанно)

- Печатные ТТК/ОП-1 (решение владельца) — модель хранит всё нужное для печати.
- Партии FIFO, цены по точкам, план-факт списаний (остаётся «Складу»), меню-инжиниринг/ABC.
- КБЖУ в гостевом интерфейсе (поля в справочнике есть, наружу не выводим).

## Известные ограничения

- В справочнике склада есть исторические дубли позиций (например, несколько «Кофе-тест»):
  миграция сливает по (имя, единица), но не трогает позиции, созданные вручную в «Складе».
  Чистка дублей — задача владельца или отдельной утилиты, на расчёт не влияет.
- Сервер пересчитывает себестоимость на каждый запрос списка карт (N карт → N расчётов).
  На 100–200 картах это единицы миллисекунд; при тысячах потребуется кэш — заложено в риски плана.
