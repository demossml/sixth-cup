# Админка: дизайн по audit (18 окт 2026)

## Что сделано (без регресса API)

### Дизайн-система (100% токены из audit)
- Цвета: page `#f5f0e6`, surface `#fffdf8`, navy sidebar `#0f172a`, yellow CTA `#fbbf24`, ink/line как в coffee.css
- Шрифты: Manrope + JetBrains Mono (woff2 в `frontend-admin/public/fonts/`)
- Tailwind tokens, Button (primary = yellow), Tabs, Badge, Card shadow

### Оболочка
- Сайдбар navy с группами: **Смена** / **Управление** / **Аналитика** / **Система** (как в прототипе)
- Бренд-марк `67coffee-mark.png`, mono-подписи
- Поиск, статус кассы, мобильная нижняя навигация + «Ещё»

### Новые экраны (UI по аудиту, API не выдуман)
- `/stock` — Склад (empty state: домена нет в backend)
- `/purchases` — Закупки (empty state: домена нет в backend)

### Не тронуто
- Все существующие `/api/admin/*` маршруты и логика Evotor / loyalty / products
- Клиентский PWA (`frontend/`)
- Передача в Evotor, получение данных

### Почему не 100% прототипа «как живой»
В `audit` заложены Склад (партии, FEFO, нормы), Закупки, инвентаризация — в текущей БД и `backend/src` этих таблиц и роутов **нет**. Добавление «как будто работают» было бы выдумкой. Экраны и навигация готовы; методы — когда появятся миграции и контракт API.

Эталон дизайна: `docs/design-audit/coffee.html`.

## Шаг 2 — склад / закупки / инвентаризация (по audit)

### Миграция `023_stock_purchases.sql`
- suppliers, stock_items, product_stock_norms
- stock_batches (FEFO-порядок в запросах), stock_movements
- purchase_invoices + lines, purchase_payments + alloc
- inventory_docs + lines

### API (`backend/src/modules/admin/stock.ts`), префикс `/api/admin`
- GET/POST/PATCH/DELETE `/stock/items`, GET `/stock/balances`, `/stock/expiry`
- GET/POST/DELETE `/stock/norms`, GET `/stock/products-without-norms`
- GET/POST/PATCH/DELETE `/suppliers`
- GET/POST `/purchases/invoices`, POST `.../post`, DELETE draft
- POST `/purchases/payments` (только с allocations), GET `/purchases/debt`
- GET/POST `/inventory`, GET `/inventory/:id`, PATCH lines, POST post

Правила audit: черновик накладной не двигает остаток; проведение создаёт партию + movement; оплата только с привязкой к накладным; инвентаризация — документ, не правка ячейки.

### Фронт
- `Stock.tsx` / `Purchases.tsx` — живые экраны на этих API (не заглушки).

Существующие маршруты и клиентский PWA не менялись.

## Шаг 3 — инвентаризация UI, оплаты, списание с SELL

### Фронт
- `Inventory.tsx` + маршрут `/inventory` + пункт в сайдбаре
- Закупки: кнопка «Оплатить долг» (POST `/purchases/payments` с allocation), поле «Годен до» на накладной

### Backend
- `stockWriteOff.ts` — soft FEFO-списание по `product_stock_norms` при успешном SELL
- Хук в `SellHandler` после loyalty-транзакции; ошибки списания **не** ломают продажу/лояльность
- Без норм / без таблиц — no-op

### По-прежнему вне объёма
- Полный pixel-port Today/Menu, экран Аналитика, справка, банк (этап 2)

## Шаг 4 — многострочные накладные, Аналитика, «Сегодня»

- Закупки: несколько строк накладной (позиция, кол-во, цена, «Годен до»), +добавить строку
- `/analytics` — KPI, график series, таблица by-store; пункт в сайдбаре «Аналитика»
- Сегодня: блок «Требует внимания» вместо «Исключения»

## Шаг 5 — нормы в UI, справка

- Склад → вкладка **Нормы**: товар меню + позиция склада + qty, список, удаление
- `/help` — статьи: начать, сценарии (приёмка, оплата, инвентаризация), логика FEFO/списание, глоссарий; поиск
- Пункт «Справка» в сайдбаре (Система)

## Шаг 6 — нормы в карточке меню, Operations

- MenuProducts ProductDrawer: блок «Списание со склада (нормы)» для сохранённого товара
- Operations: уточнён subtitle под очередь внимания
- Menu: subtitle про нормы в карточке

## Шаг 7 — контекстная справка «?», Today KPI

- `HelpLink` + deep-link `/help?a=articleId`
- «?» на: Сегодня, Склад, Закупки, Инвентаризация, Касса, Меню
- Сегодня: 4 основных KPI + компактная полоса сигналов; график navy

## Шаг 8 — «?» на остальных экранах, карточки Кассы

- HelpLink: Операции, Аналитика, Система, Клиенты, Сотрудники, Помощник
- Cash StoreCard: StatusDot, полоса статуса, ошибки/очередь, типографика design tokens

## Шаг 9 — визуальный 1:1 chrome (coffee.css)

- Подключён полный `assets/coffee.css` из audit + fonts
- Shell: классы `.app .side .nav-item .topbar .brand` как в coffee.html
- kit: Button/Card/PageHeader/KpiTile/Tabs/Badge/Input под прототип
- HelpLink chip в стиле ghost

## Шаг 10 — разметка экранов как в coffee.html

- Сегодня: page-head, kpi-grid, card.kpi, strip, cols, attention, points-table, quality-list, recent table
- Склад / Закупки / Инвентаризация / Операции / Касса / Аналитика / Справка: section.view + page-head + head-actions
