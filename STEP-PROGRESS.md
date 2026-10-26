# STEP-PROGRESS — sixth-cup admin fixes

Источник: `PROMPTS-ADMIN-FIX-SEQUENTIAL.md` + `RESEARCH-ADMIN-STUBS-STRATEGY.md`.
Правило: после каждого STEP — typecheck (затронутые пакеты) + релевантные vitest. Регрессия → стоп.

## Базовая точка (до STEP-00)

| | |
|---|---|
| HEAD | `7e67a23` (`feat(admin): make the existing admin usable on phones`) |
| Ветка | `main`, до начала работ — `origin/main` = `7e67a23` |
| Рабочее дерево на старте | untracked: `AUDIT-6.7-COFFEE-CURRENT-STATE.md`, `RESEARCH-ADMIN-STUBS-STRATEGY.md` (не коммитились в этих STEP) |
| `npm run typecheck` | 3/3 пакета OK |
| backend `vitest` (`DB_PATH=/tmp/sc-step-test.db`) | 205 passed / 36 файлов |
| frontend-admin `vitest` | 18 passed / 4 файла |
| frontend (PWA) `vitest` | 52 passed / 4 файла |

---

## STEP-00 — CI + контрактный тест client↔routes

**Статус:** DONE

**Что сделано**
- `.github/workflows/ci.yml` — `npm ci` → `typecheck` → `build` → три набора тестов (backend с `DB_PATH=/tmp/ci-backend.db`).
- `backend/src/__tests__/contract-admin-routes.test.ts` — статический контракт:
  1. сканирует `frontend-admin/src/**/*.ts(x)` на `api(...)`/`useApi(...)` и нормализует шаблоны (`${…}` → `:x`, query отбрасывается);
  2. собирает все объявленные маршруты backend с префиксами монтирования из `app.ts`;
  3. **обязательно** падает, если клиент вызывает путь без обработчика;
  4. **обязательно** падает, если клиент вызывает не `/api/admin*`;
  5. strict-режим (`CONTRACT_STRICT=1`) сверяет orphan-эндпоинты со снимком `KNOWN_ORPHAN_SERVER` (46 путей) — по умолчанию выключен, как разрешено в промпте (часть путей вызывается косвенно, через переменные и `download()`).

**Проверки**
| Команда | Результат |
|---|---|
| `npx vitest run src/__tests__/contract-admin-routes.test.ts` | 4 passed |
| `CONTRACT_STRICT=1 … contract-admin-routes` | 4 passed (снимок актуален) |
| backend полный прогон | 209 passed / 37 файлов |
| admin, PWA | 18 / 52 passed (без изменений) |

**Заметки**
- Контракт ловит ровно тот класс дефектов, что был в аудите («UI вызывает путь, которого нет»), и не требует сети/БД.
- Инверсия (сервер без клиента) намеренно не блокирует CI: в проекте есть косвенные вызовы через переменные путей, строгая проверка дала бы ложные срабатывания.

---

## STEP-01 — R-15: правда про Банк/Сверки в Help

**Статус:** DONE

**Что сделано** — `frontend-admin/src/pages/Help.tsx`, статья «Накладная и оплата» (`logic-link`):
- было: «Сверка (этап 2 / банк) в v1 не интегрирована — точка расширения в дизайне.»
- стало: описание фактических путей — «Закупки → Банк» (выписка, авто-поиск поставщика и накладной) и «Закупки → Сверки» (оборот и наш долг против данных поставщика).

Остальные статьи Help не тронуты.

**Проверки**
| Команда | Результат |
|---|---|
| `frontend-admin`: `tsc --noEmit` | OK |
| `frontend-admin`: `vitest` | 18 passed / 4 файла |
| grep «не интегрирована» в `Help.tsx` | 0 совпадений |

---

## STEP-02 — R-01 backend: миграция + `POST /purchases/bank-rows/:id/pay`

**Статус:** DONE

**Что сделано**
- Миграция `backend/src/db/migrations/030_bank_rows_payment.sql`:
  - `ALTER TABLE bank_rows ADD COLUMN payment_id INTEGER REFERENCES purchase_payments(id)`;
  - уникальный частичный индекс `uq_bank_rows_payment` (одна строка — один платёж).
- `backend/src/modules/admin/studio.ts`:
  - `bankRows()` теперь отдаёт `paymentId` и `paid`;
  - новый эндпоинт `POST /api/admin/purchases/bank-rows/:id/pay` (роли — как у `POST /purchases/payments`, т.е. owner/manager; viewer получает 403 от общего adminAuth):
    1. 404 если строки нет; **идемпотентно** возвращает существующий `paymentId` (`idempotent: true`);
    2. 400 если строка не привязана к накладной;
    3. требует `posted` и совпадения поставщика;
    4. по умолчанию — вся строка в привязанную накладную, но не больше её долга;
    5. явные `allocations` валидируются по сумме строки и по долгу каждой накладной;
    6. транзакция: `purchase_payments` + `purchase_payment_alloc` + `paid_kop` + `bank_rows.payment_id`;
    7. гонка двух POST-ов: `UPDATE … WHERE payment_id IS NULL`, при 0 changes — 409 и откат.
  - тело запроса необязательно (пустой POST = «оплатить по привязке»); невалидный JSON → 400, а не 500.

**Тесты** — `backend/src/__tests__/bank-row-pay.test.ts` (7 кейсов, isolated DB):
1. платёж создаётся, `paid_kop` растёт, `paymentId`/`paid` в списке, долг уменьшается;
2. повторный POST идемпотентен — платежей не прибавилось;
3. строка без привязки → 400 с понятным текстом;
4. чужая накладная и черновик → 400;
5. распределение больше строки / больше долга → 400, частичная оплата в пределах долга → 200;
6. нет строки → 404, без токена → 403;
7. полностью оплаченная накладная → 400 без второго платежа.

**Проверки**
| Команда | Результат |
|---|---|
| `backend`: `tsc --noEmit` | OK |
| `backend`: новый файл тестов | 7 passed |
| `backend`: полный прогон (`DB_PATH=/tmp/sc-step-test.db`) | **216 passed / 38 файлов** |
| `contract-admin-routes` | 4 passed (новый серверный маршрут не ломает контракт) |

---

## STEP-03 — R-01 UI: «Провести оплату» в «Банке»

**Статус:** DONE

**Что сделано** — `frontend-admin/src/pages/purchases/BankTab.tsx`:
- тип `BankRow` дополнен `paymentId` и `paid` (приходят из `bankRows()`);
- чистая функция `canPayRow(row)` — «оплата возможна, если накладная привязана и платежа нет»;
- в колонке «Сопоставление» для привязанной строки: кнопка **«Провести оплату»** (`size="sm" variant="secondary"`, `loading={busy}`, `aria-label` с датой) или бейдж **«оплачено»** после успеха; «отвязать» осталась рядом;
- `pay(row)` → `POST /purchases/bank-rows/:id/pay`, затем `rows.reload()` и колбэк `onPaid`;
- `Purchases.tsx`: `<BankTab onPaid={reloadAll} />` — после оплаты обновляются накладные, поставщики и «Долги», т.е. цифры на соседних вкладках не отстают;
- вёрстка/сетка/классы не менялись (только `flex-wrap` у span с бейджами, как у соседнего блока «привязать»).

**Тесты** — `BankTab.test.ts`: +1 кейс на `canPayRow` (привязана/оплачена/нет привязки). Существующие 7 кейсов парсера не тронуты.

**Проверки**
| Команда | Результат |
|---|---|
| `frontend-admin`: `tsc --noEmit` | OK |
| `frontend-admin`: `vitest` | **19 passed / 4 файла** (было 18) |
| backend | не затрагивался (216 passed, см. STEP-02) |

---

## STEP-04 — R-14: удаление сверки + CSV акта

**Статус:** DONE

**Что сделано — backend** (`backend/src/modules/admin/studio.ts`)
- `DELETE /api/admin/purchases/reconciliations/:id` — 200/404, невалидный id → 400, без токена → 403. Накладные и оплаты не затрагиваются (удаляется только запись сверки).
- `GET /api/admin/purchases/reconciliations/:id.csv` — акт сверки: BOM (для Excel), `;`-разделитель, экранирование как в `operations.csv` (общий `toCsv` из `consoleLib`): поставщик, ИНН, контакт, реквизиты, период, оборот, оплаты, наш долг, данные поставщика, расхождение, статус, комментарий. 404 на несуществующую сверку.
- Попутно: тип `reconRows()` расширен полем `notes` (нужно для CSV), поведение прежнее.

**Что сделано — UI** (`frontend-admin/src/pages/purchases/ReconTab.tsx`)
- Колонка действий: **CSV** (через существующий `download()` из `api/client`) и **удалить** (иконка, `aria-label`).
- Удаление через существующий `ConfirmDialog` (`danger`, `busy`) с текстом «Накладные и оплаты не меняются» — чтобы не пугать владельца.
- После удаления — `list.reload()`; сетка/классы вкладки не менялись.

**Тесты** — `backend/src/__tests__/recon-delete-csv.test.ts` (4 кейса):
удаление + 404 на повтор; невалидный id 400 и 403 без токена; CSV содержит BOM (по байтам `EF BB BF`), шапку `Показатель;Значение`, строки с суммами и статусом; CSV несуществующей сверки → 404.

**Проверки**
| Команда | Результат |
|---|---|
| `backend`: `tsc --noEmit` | OK |
| `backend`: полный прогон | **220 passed / 39 файлов** (было 216) |
| `frontend-admin`: `tsc --noEmit` | OK |
| `frontend-admin`: `vitest` | 19 passed / 4 файла |

**Заметки (важно для ревью)**
- Hono регистрирует параметр шаблона `:id.csv` под ключом `id.csv` (проверено пробой) — в обработчике читается `c.req.param('id.csv')`, это прокомментировано в коде.
- `toCsv` защищает от формул-инъекций, поэтому отрицательное расхождение выгружается как `'-200,00` — одинаковое поведение с `operations.csv`/`products.csv`, тест это фиксирует.

---

## STEP-05 — R-02: адресная выгрузка по `product_store_links.enabled`

**Статус:** DONE

**Гипотеза подтвердилась:** `enqueueProductSync` ставил товар в очередь **всем** точкам с `sync_enabled=1`, а `ProductPushService` отправлял всё, что оказалось в очереди — галочка «На каких точках продаётся» (`enabled`) влияла только на подсчёт в `assignments`, но не на выгрузку.

**Что сделано**
- `backend/src/integrations/evotor/sync/ProductPushService.ts`:
  - `product_store_links` в `ensureSchema()` получил колонку `enabled INTEGER NOT NULL DEFAULT 1` (+ `ALTER TABLE` для старых БД);
  - новый публичный метод `productEnabledForStore(productId, storeUuid)`: нет строки → `true` (как раньше), `enabled=0` → `false` (ошибки чтения трактуются как «разрешено», чтобы не блокировать выгрузку);
  - `enqueue()` не ставит в очередь продукт, выключенный для этой точки;
  - `pushToStoreInternal()` дополнительно фильтрует уже стоящие в очереди строки: выключенные помечаются `DONE` с `last_error='skipped: product disabled for this store'` — они не крутятся в очереди каждый цикл.
- `backend/src/modules/admin/enqueue.ts`: строит набор `store:product` с `enabled=0` и пропускает их при постановке в очередь (админский путь).
- `docs/DEVICE-CATALOG-API.md`: добавлено правило про фильтр выгрузки и обратную совместимость.

**Default из PROMPTS соблюдён:** при `enabled=0` не вызывается cloud delete и не отправляется `allow_to_sell=false`; уже созданная позиция в облаке не трогается.

**Тесты** — `backend/src/__tests__/product-store-enabled-push.test.ts` (4 кейса):
1. товар, разрешённый только на A, попадает в очередь только A;
2. товар без строк в links — в очередь обеих sync-точек (обратная совместимость);
3. `productEnabledForStore` читает галочку и по умолчанию разрешает;
4. после снятия галочки новые изменения не ставятся в очередь.

**Проверки**
| Команда | Результат |
|---|---|
| `backend`: `tsc --noEmit` | OK |
| `backend`: полный прогон | **224 passed / 40 файлов** (было 220) |
| `contract-admin-routes` | 4 passed |

---

## STEP-06 — R-03: правка и удаление поставщика

**Статус:** DONE

**Backend** (`backend/src/modules/admin/stock.ts`, `DELETE /suppliers/:id`)
- было: проверялась только `purchase_invoices`; при наличии `purchase_orders` / `supplier_returns` / `supplier_reconciliations` / `purchase_payments` / `bank_rows` / `stock_batches` физический `DELETE` падал сырой ошибкой SQLite (500).
- стало: нет поставщика → 404; собирается список зависимых документов; если они есть — поставщик **выключается** (`active=0`) и возвращается `{ ok, deactivated: true, reason: 'Есть документы: накладные (1), …' }`; если зависимостей нет — физическое удаление `{ ok, deleted: true }`.
- `stock_items.default_supplier_id` обнуляется перед удалением (это не документ, ссылку можно снять).
- `PATCH /suppliers/:id` (уже существовал) проверен тестами: меняет название/ИНН/контакт/реквизиты/отсрочку, 404 на отсутствующего, 400 на пустое имя.

**UI** (`frontend-admin/src/pages/Purchases.tsx`, вкладка «Поставщики»)
- кнопки **«Изменить»** и **«Удалить»** у каждой строки (с `aria-label`);
- одна форма `sForm` (создать/править) в существующем стиле `Card` + `Field`: название, ИНН, контакт, реквизиты для акта, отсрочка;
- удаление через `ConfirmDialog` с текстом «если есть документы — будет выключен, история и долги сохранятся»; после — `reloadAll()`, то есть обновляются и «Долги»;
- дублирующий мини-блок «Новый поставщик» удалён — вместо него та же форма (`+ Поставщик` в шапке открывает `sForm`). Это убрало дублирование кода, поведение кнопки сохранено.

**Тесты** — `backend/src/__tests__/suppliers-crud.test.ts` (5 кейсов): PATCH меняет поля; 404/400; DELETE без документов удаляет физически; DELETE с документами не отдаёт 500, а выключает с `reason`; DELETE несуществующего → 404.

**Проверки**
| Команда | Результат |
|---|---|
| `backend`: `tsc --noEmit` | OK |
| `backend`: полный прогон | **229 passed / 41 файл** (было 224) |
| `frontend-admin`: `tsc --noEmit` | OK |
| `frontend-admin`: `vitest` | 19 passed / 4 файла |

**Замечание для ревью:** `createInvoice` был случайно затронут при удалении дублирующего блока — восстановлен полностью, диф содержит только удаление `createSupplier`/`sName`/`showSupplier`.

---

## STEP-07 — R-04: юрлица в админке

**Статус:** DONE

**Что сделано** — `frontend-admin/src/pages/System.tsx`, новая вкладка **«Юрлица»** (`?tab=orgs`) на существующих эндпоинтах (новых маршрутов нет):
- список через `GET /organizations` (таблица: название, полное, ИНН, СНО, НДС, статус);
- форма создать/править: короткое название, полное, ИНН (10–12), КПП, СНО (`usn_income|usn_income_expense|osn|patent` — как в `taxRegimeZ`), ставка НДС 0–22, активность;
- кнопка «Сохранить» заблокирована, пока не заполнены обязательные поля (совпадает с zod-схемой бэкенда), ошибки API показываются тостом;
- удаление через `ConfirmDialog`; серверный 409 («Сначала удалите или переназначьте точки») показывается как есть — форма не притворяется, что удалила;
- пустое состояние объясняет, зачем это нужно («СНО и НДС попадают в каталог устройства»).

**Тесты** — `backend/src/__tests__/organizations-crud.test.ts` (3 кейса): полный CRUD-цикл; валидация (короткий ИНН, пустое имя → 400); удаление юрлица с привязанной точкой → 409 с текстом про точки.

**Проверки**
| Команда | Результат |
|---|---|
| `frontend-admin`: `tsc --noEmit` | OK |
| `frontend-admin`: `vitest` | 19 passed / 4 файла |
| `backend`: полный прогон | **232 passed / 42 файла** (было 229) |

**Заметка:** вкладка добавлена в существующий `Tabs`, мобильная навигация и десктопное меню не менялись; `?tab=orgs` работает по той же схеме, что `logs/audit/ai/danger`.

---

## STEP-08 — R-05: устройства кассы в админке

**Статус:** DONE

**Что сделано** — `frontend-admin/src/pages/Cash.tsx`, блок **«Устройства»** после токенов Эвотор (новый экран/маршрут не создавался):
- список `GET /devices`: название, точка, «зарегистрировано / код не использован», дата, статус, код регистрации (бейдж);
- создание: выбор локальной точки (`GET /stores`) + название → `POST /devices`, код показывается **один раз** отдельной карточкой с пояснением, что он одноразовый;
- «Отозвать» → `POST /devices/:id/revoke` (с подтверждением смысла в тосте: терминал больше не авторизуется);
- «Удалить» → `DELETE /devices/:id` через `ConfirmDialog` с подсказкой «если терминал используется — лучше отозвать»;
- если локальных точек нет — честный `Banner`, а не пустая форма.

**Тесты** — `backend/src/__tests__/devices-admin.test.ts` (5 кейсов): создание + код в формате `[0-9A-F]{8}` и виден владельцу; `POST /api/devices/enroll` гасит код, выдаёт токен, устройство помечается зарегистрированным; revoke проставляет флаг и 404 на несуществующем; DELETE и 403 без токена; создание с несуществующей точкой → 404.

**Проверки**
| Команда | Результат |
|---|---|
| `frontend-admin`: `tsc --noEmit` | OK |
| `frontend-admin`: `vitest` | 19 passed / 4 файла |
| `backend`: полный прогон | **237 passed / 43 файла** (было 232) |

**Заметка:** код регистрации отдаётся только роли owner (серверная проверка в `GET /devices` уже была) — менеджер увидит список без кодов.

---

## STEP-09 — R-07: `PATCH /staff/:id` + правка в админке

**Статус:** DONE

**Backend** (`backend/src/modules/staff/adminRoutes.ts`)
- новый `PATCH /api/admin/staff/:id` с частичным телом `{ name?, role?, active? }`: не переданные поля сохраняются (читаются из текущей строки), 404 на отсутствующего, 400 на пустое имя, 403 без токена.
- Выбран `PATCH`, а не расширение `POST /staff` (у него уже есть ветка по `id`), чтобы не менять существующий контракт и не затирать `store_id`/`store_uuid` при переименовании.

**UI** (`frontend-admin/src/pages/Staff.tsx`)
- кнопка **«Изменить»** у каждой строки → инлайн-форма в той же карточке («Сотрудник №id», поля ФИО/Роль, Сохранить/Отмена);
- сохранение → `PATCH /staff/:id`, затем `reload()`;
- «Отключить» осталось как было (soft-delete через `DELETE /staff/:id`).

**Тесты** — `backend/src/__tests__/staff-admin.test.ts` (5 кейсов, до этого файла на staff-admin не было ни одного теста):
создание и список; PATCH имени не затирает роль; PATCH роли не затирает имя; `active=false`; 404 / 400 / 403; привязка кассы `PUT /staff/:id/device` (+404) и деактивация `DELETE`.

**Проверки**
| Команда | Результат |
|---|---|
| `backend`: `tsc --noEmit` | OK |
| `backend`: полный прогон | **242 passed / 44 файла** (было 237) |
| `frontend-admin`: `tsc --noEmit` | OK |
| `frontend-admin`: `vitest` | 19 passed / 4 файла |

---

## STEP-10 — R-08 / R-09: склад-номенклатура и счётчики инвентаризации

**Статус:** DONE

**Backend** (`backend/src/modules/admin/stock.ts`, `DELETE /stock/items/:id`)
- было: проверялись только `stock_movements`; при наличии партий/норм/строк документов `DELETE` падал сырой ошибкой FK (500).
- стало: 404 на отсутствующую; проверяются ссылки `stock_movements`, `stock_batches`, `product_stock_norms`, `inventory_lines`, `purchase_invoice_lines`, `purchase_order_lines`, `supplier_return_lines`; при любой — позиция **выключается** (`active=0`) с `reason='Позиция используется: …'`, иначе физическое удаление.
- `PATCH /stock/items/:id` (уже был) проверен тестами: имя/минимум/артикул, 404.

**UI**
- `frontend-admin/src/pages/Stock.tsx`, вкладка «Номенклатура»: кнопки **«Изменить»**/**«Удалить»** у каждой позиции; форма правки/создания (название, артикул, тип, единица, минимум) в существующем стиле; удаление через `ConfirmDialog` с пояснением про историю.
- `frontend-admin/src/pages/Inventory.tsx`: подключён `GET /inventory/overview` — в каждой строке документа появился прогресс «посчитано N из M», кнопка «Обновить» обновляет и его. Новых экранов/маршрутов нет.

**Тесты** — `backend/src/__tests__/stock-items-inventory.test.ts` (4 кейса): PATCH/DELETE без ссылок (+404 на повтор и несуществующий); DELETE позиции с движениями → `deactivated` + причина + `active=0`; `overview` показывает `total/counted` и растёт после ввода факта; `overview` не перехватывается `/inventory/:id`.

**Проверки**
| Команда | Результат |
|---|---|
| `backend`: `tsc --noEmit` | OK |
| `backend`: полный прогон | **246 passed / 45 файлов** (было 242) |
| `frontend-admin`: `tsc --noEmit` | OK |
| `frontend-admin`: `vitest` | 19 passed / 4 файла |

---

## STEP-11 — R-23 / R-24: гигиена

**Статус:** DONE

**R-23 — мёртвый middleware** (`backend/src/app.ts`)
- удалён блок `app.use('*')`, который на каждый не-API запрос делал `existsSync(...)` и ничего не возвращал (пустая ветка с комментарием); реальная отдача статики ниже не тронута.
- **Проверено запуском** (`NODE_ENV=production`, временная БД `/tmp/spa-check.db`):
  | Запрос | Код |
  |---|---|
  | `/health` | 200 |
  | `/` (customer host) | 200 |
  | `/menu` (SPA fallback) | 200 |
  | `/` и `/menu` при `Host: admin.localhost` | 200 |
  | `/assets/<hashed>.css` (customer) и `.js` (admin) | 200 / 200 |
  | `/classic.html` (удалённый файл) | 404 — как и должно быть |
  | `/api/admin/meta` с токеном | 200 |

**R-24 — `.gitignore`**
- убрано правило `backend/src/integrations/evotor/__fixtures__/` (оно скрывало каталог **внутри** `src`, из-за чего будущие фикстуры молча не попадали в git);
- локальная выгрузка `sell-sample.json` перемещена в `backend/data/fixtures/` (этот каталог уже игнорируется: `git check-ignore` подтверждает), каталог `src/.../__fixtures__` удалён;
- фикстура тестов `backend/src/__tests__/fixtures/addons-catalog-fixture.json` отслеживается как раньше, тесты не затронуты.

**Проверки**
| Команда | Результат |
|---|---|
| `backend`: `tsc --noEmit` | OK |
| `backend`: полный прогон | **246 passed / 45 файлов** |
| `npm run build` (turbo, 3 пакета) | 3/3 OK |
| smoke-тест статики в production-режиме | см. таблицу выше |

---

## STEP-12 — финальный прогон и отчёт

**Статус:** DONE

| Проверка | Результат |
|---|---|
| `npm run typecheck` | 3/3 OK |
| `npx turbo run build --force` | 3/3 OK |
| backend `DB_PATH=/tmp/final.db` | **246 passed / 45 файлов** |
| frontend-admin | **19 passed / 4 файла** |
| frontend (PWA) | **52 passed / 4 файла** |
| Живой smoke UI на `http://admin.localhost:3970` | юрлица, устройства, оплата из банка, CSV/удаление сверки, номенклатура, счётчики инвентаризации, переименование сотрудника — OK |
| Переполнение по ширине (390/1440, 8 экранов) | 0 |

Отчёт для ревьюера: **`IMPLEMENTATION-REPORT.md`** (коммиты, таблица STEP'ов, defaults, найденные и исправленные регрессии, что НЕ сделано, ручная проверка оплаты).

Все 13 шагов (STEP-00…STEP-12) закрыты, `main` зелёный по typecheck, сборке и трём наборам тестов. Push и deploy не выполнялись.
