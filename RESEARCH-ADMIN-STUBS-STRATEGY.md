# RESEARCH — Admin stubs, bank, strategy

| | |
|---|---|
| **Дата** | 2026-10-26 |
| **Репозиторий** | `/Users/dmitrijsuvalov/Downloads/sixth-cup` (`demossml/sixth-cup`, ветка `main`) |
| **HEAD** | `7e67a23` — `feat(admin): make the existing admin usable on phones` |
| **Рабочее дерево** | чистое, кроме двух untracked MD: `AUDIT-6.7-COFFEE-CURRENT-STATE.md` (прошлый аудит) и этот файл |
| **Режим** | только чтение кода/доков; единственное изменение — этот файл |
| **Проверки (read-only, текущее состояние)** | backend `vitest` **205/205** (36 файлов), admin **18/18** (4), PWA **52/52** (4); ранее в этом же состоянии: `npm run typecheck` 3/3, `turbo run build --force` 3/3 |
| **Не входило** | репозиторий `evotor-app` (только как потребитель API), production, БД, миграции |

Легенда: **[Ф]** факт из кода · **[В]** вывод по коду · **[П]** требует проверки/решения.
Статусы UI: `DONE` (полный цикл через API и обратно) · `PARTIAL` (часть операций недоступна) · `STUB` (интерфейс без backend-эффекта) · `MISSING` (нет UI).

---

## 1. Executive summary

- **[Ф]** Админка — 18 маршрутов, все обращения к API имеют обработчик на бэкенде: 76 уникальных путей клиента, 0 «висячих» (перекрёстная проверка методом + путь, с учётом шаблонных `${…}`).
- **[Ф]** Настоящих UI-заглушек (кнопка без обработчика, форма без сохранения, hard-coded mock-строки) в `frontend-admin/src` **не найдено**. Единственные «mock»-упоминания — ветка ИИ без ключа и `EmptyState`-тексты; «скоро» в `Stock.tsx:36` — это бейдж срочности партии, не заглушка.
- **[Ф]** Обратная проблема выражена сильнее: **39 admin-эндпоинтов (из 182) без клиента** — организации (5), локальные `stores` (5), устройства (4), аналитика (6), `overview/sales/loyalty-ops` (4), склад/закупки/инвентарь (остальные).
- **[Ф] Банк:** вкладка «Банк» рабочая (импорт текстом → авто-матч → ручная привязка/отвязка → удаление), тесты `BankTab.test.ts` (7). **Но** привязка строки выписки к накладной **не создаёт платёж** — долг и сверка не меняются: `bank_rows` обновляется, `purchase_payments` нет.
- **[Ф] Сверки:** вкладка «Сверки» рабочая: создание по периоду, ввод «по данным поставщика», расхождение, статус. Считает `оборот − оплаты` (проведённые накладные vs `purchase_payments`). Нет удаления сверки и выгрузки акта.
- **[Ф] Ловушка доверия:** в карточке товара два похожих блока — «Доступность по точкам (приложение 6.7…)» (работает, `product_store_availability`) и «На каких точках продаётся» (`product_store_links.enabled`), который **нигде не читается** при выгрузке: `enqueueProductSync` ставит товар в очередь **всем** точкам с `sync_enabled=1`.
- **[Ф]** Это расходится с ТЗ: `docs/TZ-ADMIN-EVOTOR-SYNC-FULL.md:15-16` требует выгрузку «на каждой выбранной точке». То есть не косметика, а невыполненное требование (`R-02`, P2).
- **[Ф] Help внутри продукта врёт:** `Help.tsx:109` — «Сверка (этап 2 / банк) в v1 не интегрирована», хотя вкладки «Банк»/«Сверки» есть и работают.
- **[Ф] Поставщики:** создание есть, редактирования/удаления нет (`PATCH/DELETE /suppliers/:id`, `PATCH /suppliers/:id/legal` без клиента).
- **[Ф] Организации:** CRUD на бэкенде (5 методов), в UI отсутствует полностью — при этом СНО/НДС нужны кассе для чеков.
- **[Ф] Устройства кассы:** `GET/POST /devices`, `POST /devices/:id/revoke`, `DELETE /devices/:id` без UI; регистрация кассы — только `POST /api/devices/enroll` с одноразовым кодом вручную.
- **[Ф] Шаблоны ваучеров** — только чтение: `GET /voucher-templates` без POST/PATCH; массовая выдача есть.
- **[Ф] Сотрудники:** нет редактирования ФИО/роли — и в UI, и на бэкенде (`PATCH /staff/:id` отсутствует как метод).
- **[Ф] Безопасность:** при пустом `EVOTOR_PROXY_TOKEN` middleware `evotorProxy` пропускает запросы (soft mode) → `/api/devices/shift*`, `/timesheet*`, `/breaks*` без авторизации (`R-21`, P1).
- **[Ф] Схема БД** собирается из трёх источников (SCHEMA + inline `CREATE TABLE` в 6 файлах + 29 миграций), плюс ручные `ALTER TABLE` — риск дрейфа между окружениями.
- **[В]** Итог: админка — не «каркас из заглушек», а **недопостроенная операционка**. Банк/закупки имеют рабочий каркас, но денежные цифры (долг, сверка) не связаны со строками выписки; часть справочников ведётся только через API/БД.
- **[В]** Приоритет работ — не «дописать экраны», а **замкнуть денежные контуры** (выписка → платёж → долг → сверка) и **доделать адресную выгрузку в точки**, затем справочники (поставщики, организации, устройства) и тестовый слой.

---

## 2. Admin route matrix

Источник маршрутов: `frontend-admin/src/App.tsx:81-101`, меню: `frontend-admin/src/layout/Shell.tsx:16-60`. API — фактические строки вызовов в страницах (метод из `{ method: … }`).

| route | page file | вкладки | API (method + path) | UI state | Evidence |
|---|---|---|---|---|---|
| `#/` | `pages/Today.tsx` | — | GET `/dashboard?period&store`, GET `/analytics/series?…`, GET `/catalog/quality`, POST `/evotor/poll` | DONE | `Today.tsx:120-190`; счётчики качества — `/catalog/quality` (`routes.ts:1059`) |
| `#/operations` | `pages/Operations.tsx` | Все / Начислено / Без карты / Ошибки / Споры | GET `/operations?…`, GET `/operations.csv?…`, GET `/operations/:store/:doc`, GET `/disputes` | DONE | `Operations.tsx:78-200`; фильтры в адресе (`?q=&view=&store=&period=`) |
| `#/customers` | `pages/Customers.tsx` | — | GET `/customers?q&sort&dir&limit&offset` | DONE | `Customers.tsx:15-90` |
| `#/customers/:id` | `pages/CustomerCard.tsx` | — | GET `/customers/:id`, GET `/voucher-templates`, POST `/customers/:id/vouchers`, GET `/customers/:id/phone`, переход `#/operations?open=` | DONE | `CustomerCard.tsx:32-95`; телефон раскрывается отдельным действием |
| `#/menu` | `pages/Menu.tsx` → `MenuProducts.tsx`, `MenuGroups.tsx` | Товары / Группы / Добавки / Схемы добавок (`?section=`) | GET/POST `/products`, PATCH/DELETE `/products/:id`, POST `/products/bulk`, PUT `/products/:id/stores`, GET/PUT `/products/:id/availability`, GET/POST/DELETE `/product-groups`, `/categories`, `/modifiers`, `/modifier-schemes`, GET `/modifier-schemes/:id/preview`, POST `/stock/norms`, POST `/admin/upload` | **PARTIAL** | `MenuProducts.tsx:72,188-192,321,405`; `MenuGroups.tsx:35-200`; см. `R-02` (toggle без эффекта) |
| `#/cash` | `pages/Cash.tsx`, `cash/CashierMenuPanel.tsx` | — (панель «Общее меню кассы» + карточки точек) | GET `/evotor/stores`, PATCH `/evotor/stores/:uuid` (sync), POST `…/sync`, `…/push-products`, GET `…/products/drift`, POST `…/wipe-catalog`, GET `/evotor/health`, `/evotor/employees`, GET/POST/DELETE `/evotor/tokens`, POST `/evotor/tokens/:id/probe`, POST `/evotor/sync`, GET/PATCH/DELETE `/cashier/menu` | DONE (кроме устройства — `R-05`) | `Cash.tsx:41-115,173-181`; `CashierMenuPanel.tsx:24-70` |
| `#/marketing` | `pages/Marketing.tsx`, `marketing/PromoMediaField.tsx` | Контент PWA / Ваучеры (`?tab=`) | GET/POST `/promos`, PATCH/DELETE `/promos/:id`, POST `/promos/:id/publish|unpublish`, GET `/voucher-templates`, GET `/vouchers/grant-all/preview`, POST `/vouchers/grant-all`, POST `/admin/upload` | **PARTIAL** | `Marketing.tsx:140-300,370`; шаблоны только чтение (`R-06`) |
| `#/referrals` | `pages/Referrals.tsx` | — | GET `/referrals/summary?period` | DONE | `Referrals.tsx:31-60` |
| `#/analytics` | `pages/Analytics.tsx` | Вчера / 24 часа / 7 дней / 30 дней | GET `/analytics/series`, `/analytics/by-store`, `/analytics/overview`, `/analytics/heatmap` | DONE | `Analytics.tsx:80-95` |
| `#/compare` | `pages/Compare.tsx` | — | GET `/dashboard` ×2, GET `/analytics/series` ×2 | DONE | `Compare.tsx:20-70` |
| `#/events` | `pages/BusinessEvents.tsx` | — | GET `/business-events?limit` | DONE | `BusinessEvents.tsx:1-40` |
| `#/assistant` | `pages/Assistant.tsx` | срочно / внимание / к сведению / хорошо (фильтр ленты) | GET `/ai/feed`, POST `/ai/feed/:key/hide`, POST `/ai/ask`, `/ai/catalog-advice`, `/ai/content-draft`, `/ai/anomaly-explain`, `/ai/shift-summary`, GET `/ai/draft/payment`, POST `/purchases/payments` | **PARTIAL → UNVERIFIED** | `Assistant.tsx:49-95`; без `AI_API_KEY` → 503 (`ai.ts:19-26`, тест `studio.test.ts:114`) |
| `#/system` | `pages/System.tsx` | Логи / Журнал / ИИ / Опасная зона (`?tab=`) | GET `/logs`, POST `/logs/test`, GET `/audit?…`, GET/PUT `/ai/settings`, GET `/stats`, POST `/reset` | DONE | `System.tsx:50-60,226-260`; сброс скрыт без `ADMIN_ALLOW_RESET` (`meta.resetAllowed`) |
| `#/staff` | `pages/Staff.tsx` | — (секции: сотрудники, привязка кассы, день графика, правила пожеланий, пожелания) | GET/POST `/staff`, DELETE `/staff/:id`, PUT `/staff/:id/device`, GET/PUT `/staff/schedule`, GET/POST `/staff/wish-rules`, GET `/staff/wishes?month=`, PUT `/staff/wishes/:id` | **PARTIAL** | `Staff.tsx:60-140`; нет редактирования сотрудника (`R-07`) |
| `#/stock` | `pages/Stock.tsx`, `stock/RecipesTab.tsx` | Остатки / Сроки / Номенклатура / Нормы / Рецептуры / Без нормы | GET `/stock/balances`, `/stock/expiry?days=14`, `/stock/items?active=1`, `/stock/norms`, `/stock/products-without-norms`, `/products`, `/stock/recipes`; POST `/stock/items`, POST/DELETE `/stock/norms`, PUT `/stock/recipes/:productId` | **PARTIAL** | `Stock.tsx:42-120`; нет правки/удаления номенклатуры (`R-08`) |
| `#/purchases` | `pages/Purchases.tsx` + `purchases/*` | Накладные / Заказы / Возвраты / Поставщики / Долги / Банк / Сверки (`?tab=`) | GET `/purchases/invoices`, `/purchases/debt`, `/suppliers`, `/stock/items?active=1`; POST `/suppliers`, `/purchases/invoices`, `/purchases/invoices/:id/post`, `/purchases/payments`; OrdersTab: GET/POST `/purchases/orders`, PATCH/DELETE `/purchases/orders/:id`, GET `/purchases/order-helper`, POST `/purchases/orders/:id/to-invoice`; ReturnsTab: GET/POST `/purchases/returns`, POST `/:id/post`, PATCH `/:id`; BankTab и ReconTab — см. §4 | **PARTIAL** | `Purchases.tsx:36-45,116-150,330-400`; `OrdersTab.tsx:90-145`; `ReturnsTab.tsx:80-95` |
| `#/inventory` | `pages/Inventory.tsx` | — | GET `/inventory`, GET `/inventory/:id`, POST `/inventory`, PATCH `/inventory/:id/lines`, POST `/:id/recount`, `/:id/submit`, `/:id/post`, `/:id/cancel` | **PARTIAL** | `Inventory.tsx:50-145`; `overview/sheet/meta` без UI (`R-09`) |
| `#/help` | `pages/Help.tsx` | статьи по секциям (`?a=`) | — (статический контент) | DONE (кроме устаревшего текста) | `Help.tsx:109` — конфликт с фактом (`R-15`) |

Дополнительно: мобильная навигация (`Shell.tsx`, коммит `7e67a23`) — 4 пункта (Сегодня/Касса/Заказы→`?tab=orders`/«И ещё») + лист всех 15 разделов; десктопное меню не изменено [Ф].

**Вывод по матрице [В]:** ни один раздел не является «пустышкой»; 6 разделов имеют подтверждённые неполноты (`PARTIAL`), остальные закрывают свой сценарий целиком.

---

## 3. Stubs & gaps registry

Приоритет = влияние на бизнес: `P1` ломает основной процесс/безопасность, `P2` важный пробел или неверные цифры, `P3` неполнота/косметика/доки.

| ID | Severity | Что | Доказательство |
|---|---|---|---|
| `R-01` | **P2** | Привязка строки выписки к накладной не создаёт платёж → долг и сверка не меняются | `studio.ts:603-644` (только `UPDATE bank_rows`, строка `:635`); сравнить `stock.ts:554-605` (платёж + аллокация + `paid_kop`) |
| `R-02` | **P2** | «На каких точках продаётся» (`product_store_links.enabled`) не влияет на выгрузку и каталог; противоречит ТЗ | `MenuProducts.tsx:337-345` (UI), `assignments.ts:71-107` (пишет `enabled`), `enqueue.ts:9-24` (всем точкам), `ProductPushService.ts:369-371`; ТЗ `TZ-ADMIN-EVOTOR-SYNC-FULL.md:15-16` |
| `R-03` | P3 | Поставщики: нет редактирования/удаления | `stock.ts:356,380`, `studio.ts:264` (`/suppliers/:id/legal`) — клиента нет; UI `Purchases.tsx:336-360` только список |
| `R-04` | P3 | Организации: CRUD только в API | `routes.ts:213-289`; grep `organizations` в `frontend-admin/src` → 0 |
| `R-05` | **P2** | Регистрация/отзыв кассового устройства только через API | `routes.ts:362-397`, `devices/routes.ts:94-121`; клиента `/devices` нет |
| `R-06` | P3 | Шаблоны ваучеров нельзя создать/изменить | `console.ts:393` только GET; UI `Marketing.tsx:280-330` |
| `R-07` | P3 | Сотрудника нельзя переименовать/сменить роль — эндпоинта нет вовсе | `staff/adminRoutes.ts:8-62` (GET/POST/DELETE/device), UI `Staff.tsx` |
| `R-08` | P3 | Складская номенклатура: create + list, без правки/удаления | `stock.ts:90,152,179` без клиента; UI `Stock.tsx:96-120` |
| `R-09` | P3 | Инвентаризация: `overview`, `sheet`, `meta` (автор, зоны, категории) без UI | `studio.ts:751,762,775` |
| `R-10` | P3 | Аналитика: `staff`, `affinity`, `customers`, `window`, `compare`, `referrals/pairs` без UI | `studio.ts:918-997` |
| `R-11` | P3 | `overview`, `sales/summary`, `loyalty/ops`, `cashback/:userId`, `modifiers/backfill-products`, `purchases/snapshot`, `stock/snapshot`, `stock/consumption`, `invoices/:id/receive` без UI | `assignments.ts:36-170`, `routes.ts:824,1281`, `studio.ts:239,256,695,714` |
| `R-12` | P3 | Локальные `stores`: CRUD без UI (админка использует `/evotor/stores`) | `routes.ts:291-360`; UI `Cash.tsx:173` использует `/evotor/stores` |
| `R-13` | P3 | Вкладка «Банк» без импорта файла: только вставка текста | `BankTab.tsx:196-215` (textarea), парсер `BankTab.tsx:27-58` |
| `R-14` | P3 | Сверка: нет удаления и печати/экспорта акта | `ReconTab.tsx` (нет DELETE/export), `studio.ts:520-553` |
| `R-15` | P3 CONFLICT | Help говорит «Сверка (этап 2 / банк) в v1 не интегрирована» при работающих вкладках | `Help.tsx:109` vs `BankTab.tsx`/`ReconTab.tsx` |
| `R-16` | P3 CONFLICT | `DEPLOYMENT.md` обещает PWA-экран `/cashier`; маршрута нет | `DEPLOYMENT.md:7` vs `frontend/src/App.tsx:130-157` |
| `R-17` | P3 CONFLICT | `DEVICE-CATALOG-API.md` требует `storeUuid` в `PATCH /cashier/menu`; с `36e93e6` он необязателен | `DEVICE-CATALOG-API.md:145` vs `routes.ts:423-446` |
| `R-18` | P2 CONFLICT | `docs/DEVICE-SALES.md` называет `POST /api/devices/sales` основным путём; APK его не вызывает | `docs/DEVICE-SALES.md:3-7`; grep `/api/devices/sales` в `evotor-app/app/src` → 0 |
| `R-19` | P3 | ИИ: недостижимая mock-ветка `callProvider` + захардкоженный `provider: 'deepseek'` в двух обработчиках | `ai.ts:23-31` (недостижимый mock), `:134`, `:191`, `:214` (`provider: 'deepseek'` без проверки ключа) при guard `requireWriteAi` (`:19-26`) |
| `R-20` | **P2** | Web Push отсутствует: таблица `push_subscriptions` (миграция `018`) без кода, `PUSH_ENABLED` не используется | grep `push_subscriptions` в `backend/src` → 0; `config.ts:61` |
| `R-21` | **P1** | Soft-mode прокси: staff-эндпоинты без авторизации при пустом токене | `middleware/evotorProxy.ts:25-38`; `staff/deviceRoutes.ts:19` |
| `R-22` | **P2** | Три источника схемы + ручные ALTER → дрейф | `db/schema.ts`, `audit.ts:13-38`, `addonScheme.ts`, `assignments.ts:14`, `evotor/db.ts`, `tokenStore.ts`, `ProductPushService.ts:198-212`, `db/migrations/*.sql` (29) |
| `R-23` | P3 | Мёртвый middleware с `existsSync` в горячем пути статики | `app.ts:182-197` (пустая ветка) |
| `R-24` | P3 | `.gitignore` скрывает каталог внутри `src/` | `.gitignore:8` (`backend/src/integrations/evotor/__fixtures__/`) |
| `R-25` | P3 | Демо-данные в dev (`seedIfEmpty`) создают ложное впечатление «уже настроено» | `db/seed.ts:31-35` (только `config.isDev`), вызов `index.ts:11` |

Проверено и **не является** заглушкой (чтобы не переделывать зря) [Ф]:
- `Stock.tsx:36` «скоро» — бейдж срочности партии (`urgencyBadge`).
- `MenuProducts.tsx:390` «нейтральная заглушка» — текст про отсутствие фото.
- Все `EmptyState` («Накладных пока нет» и т.п.) — честные пустые состояния при пустой БД.
- Кнопки без `onClick` не найдены (проверка парсером всех `<Button …>` с учётом многострочных тегов и `onClick`).

---

## 4. Bank & reconciliation deep-dive

### 4.1 Что есть в UI

**Вкладка «Банк» (`pages/purchases/BankTab.tsx`, 255 строк)**
- Вставка выписки текстом: `дата; контрагент; назначение; сумма` (разделитель `;` или таб), парсер `parseBankLine`/`parseBankText` (`BankTab.tsx:27-58`) — с обработкой «12.500,00», минусов, ошибок строк; покрыто `BankTab.test.ts` (7 тестов).
- `POST /api/admin/purchases/bank-rows` → сервер матчит по имени поставщика и номеру накладной в назначении (`studio.ts:563-593`), возвращает `{imported, matched}`.
- Таблица строк: дата, контрагент, назначение, сумма, «сопоставление» (бейдж «накладная N» + «отвязать» / селект «привязать к накладной…», отсортированный так, что совпадающий поставщик сверху), удаление с подтверждением.
- `PATCH /purchases/bank-rows/:id` (`studio.ts:604-644`): валидирует накладную и её поставщика, тянет поставщика из накладной, поддерживает отвязку (`invoiceId: null`).
- `DELETE /purchases/bank-rows/:id` (`studio.ts:594-597`) — hard delete без проверок.

**Вкладка «Сверки» (`ReconTab.tsx`, 207 строк)**
- Создание: поставщик + период (`POST /purchases/reconciliations`, `studio.ts:522-538`, проверка `periodTo >= periodFrom` и существования поставщика).
- Список: оборот (сумма проведённых накладных за период), «наш долг» (`оборот − оплаты`), ввод «по данным поставщика» (руб., `onBlur` → PATCH), расхождение (`their − our`, бейдж «сходится»/сумма), статус (`draft/sent/agreed/mismatch`, PATCH).
- Расчёт: `reconRows()` (`studio.ts:114-133`) — `turnover` из `purchase_invoices (status='posted')`, `paid` из `purchase_payments`, `diff = theirBalance − ourBalance`.

### 4.2 Ключевой разрыв (главный вывод этого раздела)

**[Ф] Строка выписки не связана с деньгами.** `PATCH /purchases/bank-rows/:id` меняет только `bank_rows.supplier_id/invoice_id`. Долг считается из `purchase_invoices.paid_kop`, который увеличивается **только** в `POST /purchases/payments` (`stock.ts:554-605`) и при проведении/оплате через UI (`Purchases.tsx:126-148` — кнопка «Оплатить долг» по накладной; `Assistant.tsx:74-92` — черновик оплаты).

Следствия:
1. «Банк» и «Долги/Сверки» — два независимых мира: привязанная строка выписки нигде не уменьшает долг.
2. Пользователь видит «сопоставлено», но в «Долгах» сумма не меняется → доверие к цифрам падает.
3. Help (`Help.tsx:109`) объясняет это как «не интегрировано» — но UI уже есть, поэтому текст вводит в заблуждение (`R-15`).

Что **не** является проблемой [Ф]: `POST /purchases/payments` требует аллокаций по накладным и валидирует поставщика/статус (`stock.ts:566-600`); долг в списке накладных растёт/гасится корректно в пределах платежей.

### 4.3 Чего нет (для планирования)

| Нужно | Сейчас | Мин. решение |
|---|---|---|
| Импорт файла выписки (CSV/1C-клиент/OFX) | только вставка текста | отдельный парсер в существующем `BankTab` + drag&drop, без нового экрана |
| Превращение сопоставленной строки в платёж | нет | действие «Создать оплату из строки» → существующий `POST /purchases/payments` с аллокацией на привязанную накладную (один метод, без новой схемы) |
| Частичная оплата одной строкой | нет | там же: `amountKop` = сумма строки, распределение пользователем |
| Массовое сопоставление | нет | `PATCH` уже есть; нужен батч-метод или цикл по выбранным |
| Реверс/редактирование сверки | нет (только статус) | `DELETE /purchases/reconciliations/:id` + запрет при `agreed` |
| Акт сверки (печать/PDF/CSV) | нет | CSV на существующем `lib/csv.ts` |
| Валидация дублей выписки | нет | уникальность `(date_at, amount_kop, party, purpose)` или предупреждение в UI |

### 4.4 Оценка «где мы»

- Каркас: **DONE** — данные вводятся, читаются, связываются, удаляются; тесты на парсер есть.
- Денежная логика: **MISSING** — привязка не влияет на долг/сверку.
- Операционная зрелость: **PARTIAL** — нет файлового импорта, батч-операций, акта, дедупа.

---

## 5. Backend↔UI mismatches

Метод: извлечение всех `.get/.post/.patch/.put/.delete('<path>')` из `backend/src/**` (многострочные тоже), вычисление полного пути по точкам монтирования (`app.ts:145-158`), сопоставление с текстом клиента по шаблону с `:param → [^/]+` и обязательным началом литерала пути (`'`/`` ` ``/`"`).

### A. Admin API есть, клиента нет — **39 из 182**

| Группа | Пути | Severity |
|---|---|---|
| Организации | `GET/POST /organizations`, `GET/PATCH/DELETE /organizations/:id` | P3 (`R-04`) |
| Локальные точки | `GET /stores`, `GET/POST/PATCH/DELETE /stores` | P3 (`R-12`) |
| Устройства | `GET/POST /devices`, `POST /devices/:id/revoke`, `DELETE /devices/:id` | P2 (`R-05`) |
| Назначения/сводки | `GET /overview`, `GET /sales/summary`, `GET /loyalty/ops`, `POST /products/:id/sync` | P3 (`R-11`) |
| Аналитика | `/analytics/staff`, `/analytics/affinity`, `/analytics/customers`, `/analytics/window`, `/analytics/compare`, `/referrals/pairs` | P3 (`R-10`) |
| Закупки | `GET /purchases/snapshot`, `POST /purchases/invoices/:id/receive`, `PATCH /suppliers/:id`, `DELETE /suppliers/:id`, `PATCH /suppliers/:id/legal` | P3 (`R-03`, `R-11`) |
| Склад | `GET/PATCH/DELETE /stock/items/:id`, `GET /stock/snapshot`, `GET /stock/consumption` | P3 (`R-08`, `R-11`) |
| Инвентаризация | `GET /inventory/overview`, `GET /inventory/:id/sheet`, `PATCH /inventory/:id/meta` | P3 (`R-09`) |
| Сервис | `POST /modifiers/backfill-products`, `GET /cashback/:userId` | P3 (`R-11`) |

### B. UI есть, backend нет — **0**

Все 21 «подозрительных» совпадения при строгой проверке оказались шаблонными путями (`/customers/${id}` → `/customers/`), для которых обработчик найден. Итог: UI→404 в текущем состоянии нет [Ф].

### C. Docs обещают, кода нет

| Обещание | Источник | Факт | ID |
|---|---|---|---|
| Web Push (VAPID, триггер после SELL, ≤1/сутки) | `docs/PUSH.md` | таблица есть, кода нет | `R-20` |
| PWA-экран `/cashier` | `DEPLOYMENT.md:7` | маршрута нет | `R-16` |
| `PATCH /cashier/menu` требует `storeUuid` | `docs/DEVICE-CATALOG-API.md:145` | необязателен | `R-17` |
| `POST /api/devices/sales` — «основной путь» | `docs/DEVICE-SALES.md` | APK не вызывает | `R-18` |
| Сверка «не интегрирована» | `Help.tsx:109` | вкладки работают | `R-15` |
| Выгрузка товара на выбранные точки | `TZ-ADMIN-EVOTOR-SYNC-FULL.md:15-16` | выгружается на все sync-точки | `R-02` |

---

## 6. Traps & anti-patterns

### 6.1 `EVOTOR_PROXY_ENFORCE` / device routes без токена (P1)
`middleware/evotorProxy.ts:25-38`: если `EVOTOR_PROXY_TOKEN` пуст — `return next()` без проверки, с однократным предупреждением. Затронуты `staff/deviceRoutes.ts` (`/shift/*`, `/timesheet*`, `/breaks/*`). При этом `/loyalty/resolve` и `/logs` защищены иначе (503 при пустом токене, `devices/routes.ts:46,86`).
**Чем опасно:** кадровые данные и отметки перерывов можно читать/писать из сети без секрета.
**Как не сломать:** включать enforce одновременно с настройкой кабинета Эвотор (инъекция `Authorization`), иначе касса перестанет получать данные.

### 6.2 Три источника схемы БД (P2)
`db/schema.ts` (12 таблиц) + `CREATE TABLE IF NOT EXISTS` в 6 файлах + 29 миграций + ручные `ALTER TABLE` (`audit.ts:32-38`, `assignments.ts:14`).
**Антипаттерн:** «добавлю колонку в CREATE TABLE» — на существующей БД колонка не появится (`IF NOT EXISTS` не меняет схему), нужен `ALTER`/миграция. Порядок применения нигде не зафиксирован контрактом.

### 6.3 CONFLICT docs vs code (P2–P3)
См. §5C. Все шесть пунктов — «документ врёт», а не «код сломан». Отдельно опасен `Help.tsx:109`: он виден пользователю в интерфейсе.

### 6.4 Закупки: PATCH supplier только через API (P3)
`Purchases.tsx` умеет только создать поставщика. Опечатка в названии/ИНН не исправляется → кривая аналитика по долгам. Эндпоинты готовы (`stock.ts:356,380`).

### 6.5 Мёртвый middleware / static `existsSync` (P3)
`app.ts:182-197`: блок читает `existsSync` на каждый не-API запрос и ничего не делает (пустая ветка с комментарием). Второй блок ниже (`:202+`) реально отдаёт файлы. Удалять безопасно, но это отдельный коммит с проверкой статики по обоим `Host`.

### 6.6 Модель добавок: `modifiers` без Evotor UUID — так и должно быть
Факт [Ф]: `modifiers` (миграция `003:3-12`) не имеет `evotor_uuid`; связь идёт `modifiers.linked_product_id` → `products` (прокси-товар, `catalog_source='SIXTH_CUP'`) → `product_store_links(store_uuid, evotor_uuid)` (миграции `025:4`, `027:39-89`; фабрика товара — `addonScheme.ts:syncModifierProduct`).
**Почему не надо «добавить `evotor_uuid` в `modifiers`»:** UUID **разный для каждой точки** (свой в каждом магазине), а `modifiers` — глобальная сущность без привязки к точке. Хранение UUID в `modifiers` сломало бы мультиточность и продублировало единственный источник истины. Правильное направление — читать UUID через существующую цепочку (`products` + `product_store_links`), как это уже делает каталог (`devices/routes.ts:330-350`).

### 6.7 Mock/fixture, которые маскируют дыры
- **`seedIfEmpty()`** (`db/seed.ts:31`) наполняет dev-БД точками, категориями и товарами → на скриншотах «всё уже настроено», а на пустой prod-БД те же экраны будут пустыми. В production не запускается (`if (!config.isDev) return`).
- **ИИ-mock** недостижим (guard `requireWriteAi`), но два обработчика всё равно возвращают `provider: 'deepseek'` — если guard ослабят, UI покажет «Готово» на заготовке (`Assistant.tsx:54` различает `mock`).
- **`backend/src/integrations/evotor/__fixtures__/sell-sample.json`** — локальный, не в git и не читается кодом (проверено grep) → не считается доказательством работы интеграции.
- **Тесты с фикстурами** (`sell-fixture`, `addons-e2e`) проверяют обработчики, а не облако/терминал; зелёный прогон ≠ рабочая интеграция.

---

## 7. Implementation strategy by feature

Общие правила (чтобы не плодить дубли): новые экраны не создаём — только блоки внутри существующих страниц; все операции — через существующие эндпоинты; где эндпоинта нет, добавляем **один** метод в существующий модуль (`studio.ts`/`stock.ts`/`assignments.ts`), не новый роутер; каждый шаг закрывается тестом до реализации UI.

### 7.1 Банк → платежи → долг (P2, `R-01`)
**Цель:** сопоставленная строка выписки должна уменьшать долг и попадать в сверку.

1. **Контракт (backend, один метод):** `POST /api/admin/purchases/bank-rows/:id/pay`
   - body: `{ allocations: [{ invoiceId, amountKop }] }` (по умолчанию — привязанная накладная на остаток);
   - внутри: `INSERT purchase_payments` + `purchase_payment_alloc` + `UPDATE purchase_invoices.paid_kop` + `UPDATE bank_rows SET payment_id` (новая колонка миграцией) — транзакция;
   - ограничения: сумма аллокаций = сумма строки (или меньше, с «частично»), накладная проведена и принадлежит поставщику строки, повторный вызов идемпотентен по `bank_row.payment_id`.
2. **Схема:** миграция `030_bank_rows_payment.sql` (`ALTER TABLE bank_rows ADD COLUMN payment_id INTEGER`), уникальный индекс `(payment_id)`.
3. **UI:** в `BankTab` на сопоставленной строке — кнопка «Провести оплату» (одна кнопка, без нового экрана), состояние «оплачено» после успеха; при частичной оплате — поле суммы.
4. **Сверка:** `reconRows` уже считает по `purchase_payments` → после шага 1 расхождение начнёт сходиться само, менять расчёт не нужно.
5. **Приёмка:** загрузить строку → привязать к накладной → «Провести оплату» → в «Долгах» сумма уменьшилась; в «Сверках» за период `ourBalance` уменьшился; повторный клик не создаёт второй платёж.
6. **Тесты:** backend (happy path, чужой поставщик, уже оплаченная накладная, повтор), admin (расширить `BankTab.test.ts` чистой функцией распределения).

### 7.2 Адресная выгрузка товаров (P2, `R-02`)
**Цель:** товар уезжает только на выбранные точки — как в ТЗ.

1. Выбор семантики: `product_store_links.enabled` — единственный флаг «продаётся на точке» (второй, `product_store_availability`, оставить для PWA/кассы как «показывать в меню», это разные вещи и в UI это уже подписано).
2. Backend: в `enqueue.ts` фильтровать по `enabled` (`JOIN product_store_links`), в `ProductPushService.pushToStore` — тоже (страховка от старых очередей); при `enabled=0` — не создавать исходящих операций.
3. Обратная совместимость: для товаров без строк в links считать `enabled=1` (как сейчас), иначе «пропадут» все ранее выгруженные.
4. Снятие галочки: решить продуктово — «не выгружать новые изменения» или «снять с продажи в облаке» (`allow_to_sell=false`). По умолчанию — первое (безопасно).
5. Приёмка: товар с галочкой только на точке A не появляется в облаке точки B; `drift` по B не показывает его; снятие галочки не удаляет уже созданную позицию.
6. Тесты: `evotor-product-sync` (новый кейс «только выбранные точки»), `assignments` (чтение `enabled`).

### 7.3 Поставщики (P3, `R-03`)
1. UI: в существующей вкладке «Поставщики» — «Изменить» (`PATCH /suppliers/:id`) и «Удалить» (`DELETE`, с 409 при связанных накладных).
2. Backend: проверить, что `DELETE` отдаёт понятную ошибку при FK (сейчас — прямая попытка удаления, `stock.ts:380`).
3. Реквизиты для акта: `PATCH /suppliers/:id/legal` вывести в ту же форму (поля ИНН/КПП/адрес).
4. Приёмка: правка названия видна в накладных/сверках; удаление с документами запрещено с текстом.

### 7.4 Организации (P3, `R-04`)
1. Разместить в `#/system` новый блок (не маршрут) или секцию в `#/cash` — «Юрлица»: список, создание, правка, СНО (`tax_regime`), НДС.
2. Использовать существующие 5 методов; ничего не добавлять на бэкенде.
3. Приёмка: организация создаётся, привязывается к точке, касса получает реквизиты в `GET /api/devices/catalog`.

### 7.5 Устройства кассы (P2, `R-05`)
1. В `#/cash` блок «Устройства»: список (`GET /devices`), «Добавить» (`POST /devices` → показать одноразовый `enroll_code`), «Отозвать» (`POST /devices/:id/revoke`), «Удалить».
2. Показать инструкцию ввода кода на терминале (существующий `POST /api/devices/enroll`).
3. Приёмка: код виден один раз, после enroll устройство в статусе «активно», revoke → 401 на устройстве.

### 7.6 Справочники склада и инвентаризации (P3, `R-08`, `R-09`)
1. Склад: «Изменить»/«Удалить» для `stock_items` (`PATCH/DELETE /stock/items/:id`), запрет удаления при остатках/нормах.
2. Инвентаризация: в существующем экране подтянуть `GET /inventory/overview` (счётчики «посчитано/всего») и `PATCH /inventory/:id/meta` (автор, зоны) — без новых экранов.
3. Приёмка: правки видны после перезагрузки, остатки не ломаются.

### 7.7 Шаблоны ваучеров (P3, `R-06`)
1. Если шаблоны должны быть редактируемыми — добавить `POST/PATCH /voucher-templates` в `admin/routes.ts` (рядом с `console.ts:393`) + форма в существующей вкладке «Ваучеры».
2. Если нет — убрать впечатление «управляемого списка» и явно подписать «шаблоны задаются при настройке».

### 7.8 Сотрудники: редактирование (P3, `R-07`)
1. Backend: `PATCH /api/admin/staff/:id` (имя, роль, активность) в `staff/adminRoutes.ts` рядом с существующими.
2. UI: «Изменить» в списке.
3. Приёмка: переименование отражается на кассе (`shift/team`).

### 7.9 Web Push (P2, `R-20`) — только если подтверждено продуктово
1. Backend: `POST /api/push/subscribe` (сохранить `push_subscriptions`), отправка в `SellHandler` при `cupsTowardFree === cupsForFree − 1`, лимит 1/сутки (таблица `app_settings` или колонка `last_push_at`).
2. PWA: регистрация service worker + подписка (существующий `vite-plugin-pwa`).
3. Приёмка: одна доставка в сутки, отписка работает.

### 7.10 Глобальный порядок этапов (P0→P3, админ-операционка в приоритете)

| Этап | Состав | Почему так |
|---|---|---|
| **0. База** | CI (typecheck + 3 теста + build), контрактные тесты «client↔routes», фикс `R-23`/`R-24` | без этого каждый следующий шаг грозит регрессией; дёшево |
| **1. Деньги** | `R-01` (банк → платёж → долг), `R-15` (Help-текст), `R-14` (удаление сверки/CSV) | это то, что владелец делает с телефона каждый день; сейчас цифры не сходятся |
| **2. Мультиточка** | `R-02` (адресная выгрузка) + обновить `docs/DEVICE-CATALOG-API.md` | нельзя расширять сеть, пока товар льётся во все точки |
| **3. Справочники** | `R-03` поставщики, `R-04` организации, `R-05` устройства, `R-07` сотрудники | убирают «только через API», снижают зависимость от разработчика |
| **4. Полнота склада** | `R-08`, `R-09`, `R-06` | операционка склада, не блокирует деньги |
| **5. Безопасность/инфра** | `R-21` (enforce прокси, вместе с кабинетом), `R-22` (контракт схемы), `R-25` (dev-seed оставить) | требует внешней настройки/аккуратности |
| **6. Опционально** | `R-20` (push), `R-10`/`R-11` (вывести остальную аналитику в UI или удалить), `R-18` (решение по `/devices/sales`), `R-13` (файловый импорт) | требуют продуктового решения |

---

## 8. Testing strategy

### 8.1 Текущее состояние (факт)
| Набор | Что есть | Пробелы |
|---|---|---|
| Backend (**205 тестов / 36 файлов**) | `app.request` + изолированная БД (`vitest.config.ts` + `setup-isolated-db.ts`), покрыты каталог/добавки/лояльность/poll/закупки-склад-инвентарь/логи/админ-аудит | нет тестов: `staff/adminRoutes.ts` (10 маршрутов), `upload` (только сигнатуры), `public/content`, `devices/images`, `devices/whoami`, `evotorProxy` (soft/enforce), организации |
| Admin (**18 / 4 файла**) | чистые функции: `addonScheme` (4), `CashierMenuPanel` (4), `BankTab` (7), `mediaUrl` (3) | нет компонентных тестов React (нет `@testing-library`) |
| PWA (**52 / 4 файла**) | `menuModel` (19), `ui` (10), `alpaca/levels` (6), `RunnerCore` (17) | нет тестов интеграции с API |

### 8.2 Целевая пирамида для sixth-cup
1. **Контрактные (дешёвые, высокий ROI).** Скрипт-тест в `backend/src/__tests__/contract-routes.test.ts`: собирает все `api(...)`/`useApi(...)` пути из `frontend-admin/src` и все маршруты бэкенда, падает при (а) вызове без обработчика, (б) **allowlist** для «есть, но не нужно» — чтобы новые orphan-эндпоинты не появлялись молча. Это уже делалось вручную (§5) — надо зафиксировать.
2. **Backend-интеграция (основной вес).** Только `app.request` + `DB_PATH` во временном файле; каждый новый метод (§7) идёт с тестом: happy path, отказ по роли, отказ по статусу/владельцу, идемпотентность.
3. **Денежные инварианты (отдельная группа).** «После оплаты `paid_kop` ≤ `total_kop`», «сумма аллокаций = платежу», «банк-строка не создаёт второй платёж», «сверка: diff = 0 при равных суммах». Именно эти тесты ловят `R-01`.
4. **Admin UI (точечно).** `@testing-library/react` — только если согласовано (новая зависимость). Минимум: `BankTab` (привязка → «Провести оплату»), `Purchases` (создание/проведение), `CashierMenuPanel` (общая/точечная настройка), `Staff` (сохранение дня). Формат — «рендер + клик → вызвался нужный fetch», без снапшотов.
5. **PWA** — оставить unit-уровень; e2e не окупается на текущем объёме.

### 8.3 Что **не** гонять на production-БД
- Ни один тест не должен открывать `backend/data/sixth-cup.db` (сейчас защищено `setup-isolated-db.ts`, но `db/index.ts` открывает БД при импорте — любой новый тест без `DB_PATH` снова загрязнит рабочую).
- `POST /api/admin/reset`, `POST /devices/:id/revoke`, `wipe-catalog` — только на временной БД; e2e-сценарии с реальным облаком — только на тестовом магазине.

### 8.4 CI как критерий «этап готов»
Один workflow (`.github/workflows/ci.yml`): `npm ci` → `npm run typecheck` → `vitest` в `backend`, `frontend`, `frontend-admin` → `npm run build`. Красный CI = этап не мержится. Сейчас CI отсутствует (`R-22`/этап 0).

---

## 9. Recommended roadmap (ordered, no code)

1. **CI + контрактный тест** (этап 0) — 1 коммит, фиксирует текущее зелёное состояние и запрещает новые orphan-эндпоинты без решения.
2. **`R-15`** — поправить текст Help про банк (одна строка, снимает прямое вранье в UI).
3. **`R-01` шаг 1** — миграция `bank_rows.payment_id` + `POST /bank-rows/:id/pay` + backend-тесты (без UI).
4. **`R-01` шаг 2** — кнопка «Провести оплату» в `BankTab` + тест чистой функции распределения.
5. **`R-14`** — удаление сверки + CSV акта (на существующем `lib/csv.ts`).
6. **`R-02`** — фильтрация по `enabled` в `enqueue`/`push`, тест «только выбранные точки», обновление `DEVICE-CATALOG-API.md`.
7. **`R-03`, `R-04`, `R-05`, `R-07`** — справочники на существующих эндпоинтах (+ 1 метод для `PATCH /staff/:id`).
8. **`R-08`, `R-09`, `R-06`** — полнота склада и ваучеров.
9. **`R-21`** — enforce прокси вместе с настройкой кабинета (координация с кассой).
10. **`R-22`** — контракт схемы: тест «после миграций есть нужные таблицы/колонки»; новые объекты только миграциями.
11. **`R-10`/`R-11`** — решение: вывести в UI или удалить; без решения не трогать.
12. **`R-20` (push), `R-18` (`/devices/sales`), `R-13` (файловый импорт)** — по продуктовому решению.

Зависимости: 4 → 3; 6 не зависит от 3–5; 7 зависит от 1 (CI) для безопасного мержа; 9 зависит от настройки облака; 11/12 внешних зависимостей не имеют, но требуют приоритизации.

---

## 10. Out of scope / needs product decision

| Вопрос | Почему нужно решение |
|---|---|
| Семантика снятия галочки «продаётся на точке» | «не выгружать изменения» vs «снять с продажи в облаке» — разные последствия на кассе (`R-02`) |
| `POST /api/devices/sales` | APK его не использует; удалять или подключать — влияет на контракт кассы (`R-18`) |
| Web Push | план в `docs/PUSH.md`, нет требования-ТЗ и нет VAPID (`R-20`) |
| Шаблоны ваучеров | редактируемые или задаются при настройке (`R-06`) |
| 39 orphan-эндпоинтов | вывести в UI или удалить (`R-10`, `R-11`, `R-12`) |
| Файловый импорт выписки | нужен ли формат банка/1С или достаточно вставки текста (`R-13`) |
| `enforce` прокси | требует настройки прокси в кабинете Эвотор; иначе касса встанет (`R-21`) |
| Роли (owner/manager/viewer) для новых блоков | какие операции доступны manager'у в банке/закупках |
| Не входило в это исследование | `evotor-app` (Kotlin), production-конфигурация, реальная БД, миграции данных, деплой |

---

## 11. What I did not change

- Исходники, тесты, конфигурация, миграции, `package.json`, `.gitignore` — **не изменялись**.
- Никаких `commit`/`push`/`deploy`; ветки/worktree/stash не создавались; БД и `seed` не запускались.
- Единственное изменение в репозитории — создание этого файла:

```
$ git status --short
?? AUDIT-6.7-COFFEE-CURRENT-STATE.md   (создан прошлым аудитом, не мой в этом прогоне)
?? RESEARCH-ADMIN-STUBS-STRATEGY.md    (этот отчёт)
```

- Проверки запускались только read-only: `vitest` в `backend` (205/205), `frontend-admin` (18/18), `frontend` (52/52). Сборка/typecheck в этом прогоне не перезапускались; на этом же HEAD они были зелёными (3/3 и 3/3) в предыдущем аудите.
- `evotor-app` не открывался на запись; использовался только для проверки, вызывает ли APK конкретные эндпоинты (`R-18`).
