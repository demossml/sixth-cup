# STEP-WH-PROGRESS — Склад W0–W2

Источник: `PROMPTS-WAREHOUSE-W0-W2-SEQUENTIAL.md` (ID: Q-01…Q-11, M-01, M-03, U-01, U-04, U-05 из `RESEARCH-WAREHOUSE-INDUSTRY-VS-67.md`).

## Базовая точка (STEP-W00)

| Параметр | Значение |
|---|---|
| Дата | 2026-10-27 |
| HEAD | `9603414` feat(admin): explain the "all" tab switch on the cashier menu |
| Ветка | `main` (см. DEFAULT-AD-HOC W00-1) |
| `npm run typecheck` | OK, 3 пакета |
| Backend тесты | 248 passed / 45 файлов (`DB_PATH=/tmp/wh-test.db`) |
| frontend-admin тесты | 24 passed / 5 файлов |
| PWA (frontend) тесты | 52 passed / 4 файла |
| Чужие незакоммиченные файлы | `AUDIT-6.7-COFFEE-CURRENT-STATE.md`, `RESEARCH-ADMIN-STUBS-STRATEGY.md` (untracked, не трогаем) |
| Миграции | последняя `030_bank_rows_payment.sql`; 031/032/033 свободны |
| «Известный долг базы» | нет, все наборы зелёные |

## STEP-W00 — Базовая точка и файл прогресса
Статус: DONE
Коммит: см. `docs(stock): baseline and progress file for warehouse W0-W2`
Что сделано: снят базовый срез (typecheck, 3 набора тестов), создан файл прогресса.
Тесты: новых нет; baseline — backend 248, admin 24, PWA 52; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC:
- **W00-1 (ветка).** D-01 предписывает ветку `wh/w0-w2`, но пользователь в этой сессии трижды явно требовал работать только в существующей `main` без новых ветвей. Приоритет у прямого указания пользователя: работа идёт в `main`, коммиты локальные, push не выполняется. Если понадобится изоляция — ветку можно нарезать одним `git branch wh/w0-w2 <sha>` в любой момент, история линейна.

## STEP-W01 — Списание сырья на каждом SELL (Q-01)
Статус: DONE
Коммит: `fix(stock): write off raw stock on every SELL, not only loyalty-card receipts (Q-01)`
Что сделано:
- `PollService.processDocument` разделён на `processLoyalty` (прежняя логика без изменений) и `processStock` (склад на любом SELL, после лояльности).
- `SellHandler.handleSell` больше не трогает склад: импорт `stockWriteOff` и блок «Soft stock write-off» удалены, `qty` добавлен в `sellInternals`.
- `stockWriteOff.writeOffSellByNorms` возвращает `WriteOffResult` (`duplicate/written/skippedNoProduct/skippedNoNorms`), работает в одной транзакции и бросает ошибки наружу (D-05).
- Новый `processing/StockHandler.ts` с `applyStockForDocument`.
Тесты: `wh-sell-stock.test.ts` — 11 passed; охранный набор лояльности — 40 passed; полный backend — 259 passed / 46 файлов; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-W02 — Возврат сырья при PAYBACK (Q-02)
Статус: DONE
Коммит: `fix(stock): restore raw stock on PAYBACK from prior sale_out movements (Q-02)`
Что сделано:
- Миграция `031_stock_movements_ref.sql`: `stock_movements.ref_doc_id` + индекс (D-10).
- `stockWriteOff.restoreByPayback`: идемпотентность по PAYBACK, база — `sale_out` по `baseDocumentUUID`, лимит `списано − возвращено`, распределение LIFO по партиям с капом `qty_in` (D-07…D-10).
- `SellHandler.baseDocumentIdOf` вынесен в `sellInternals` и используется в `handlePayback` (поведение то же).
- `StockHandler` маршрутизирует `PAYBACK` → `restoreByPayback`; без `baseDocumentUUID` — `skipped: no_base_document`.
Тесты: `wh-payback-stock.test.ts` — 9 passed; охранный набор — 40 passed; полный backend — 268 passed / 47 файлов; typecheck OK
Изменённые тесты: `wh-sell-stock.test.ts` → «applyStockForDocument пропускает PAYBACK как неизвестный тип» переименован в «PAYBACK уходит в ветку возврата (с W02)»: тест фиксировал промежуточное поведение W01, которое этот STEP и меняет.
DEFAULT-AD-HOC: нет

## STEP-W03 — Инвентаризация: защита статусов проведения (Q-03)
Статус: DONE
Коммит: `fix(stock): block inventory posting from cancelled/draft and double-post (Q-03)`
Что сделано:
- `POST /inventory/:id/post`: проведение только из `counting`/`review`; `cancelled` → 400 «Документ отменён»; `draft` → 400 «Сначала внесите подсчёт»; документ без строк → 400.
- Статус захватывается внутри транзакции (`UPDATE … WHERE status IN ('counting','review')`), `changes = 0` → 409; прежний UPDATE статуса в конце транзакции убран (D-11).
- UI `Inventory.tsx`: `canPost` учитывает статус документа, кнопка «Провести» неактивна вне `counting`/`review`.
Тесты: `wh-inventory-guards.test.ts` — 6 passed; полный backend — 274 passed / 48 файлов; admin — 24 passed; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-W04 — Инвентаризация: книжный остаток на момент проведения (Q-04)
Статус: DONE
Коммит: `fix(stock): compute inventory delta from fresh balance at posting time (Q-04)`
Что сделано:
- В транзакции проведения `book_qty` пересчитывается через `expectedQty(item, doc.storeUuid)` и записывается в `inventory_lines.book_qty`; дельта считается от него (D-12).
- Допуск `abs(delta) < 1e-6` — строка пропускается (D-13). Снимок при создании документа остался для экрана подсчёта.
Тесты: `wh-inventory-book.test.ts` — 5 passed; полный backend — 279 passed / 49 файлов; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-W05 — Видимые ошибки списания (Q-05)
Статус: DONE
Коммит: `fix(stock): surface stock write-off failures via log, disputes and evotor_docs.last_error (Q-05)`
Что сделано:
- `PollService` принимает третий необязательный параметр `deps.applyStock` (подмена в тестах, прежняя сигнатура сохранена).
- `processStock` при ошибке пишет лог, строку `disputes(kind='stock_writeoff_failed', receipt_id=<чек>)` и `evotor_docs.last_error='stock: …'`; статус остаётся `PROCESSED` (D-04).
- Пустых `catch {}` вокруг склада не осталось (единственный оставшийся — `JSON.parse` в `getSc`, к складу не относится).
Тесты: `wh-stock-errors.test.ts` — 3 passed; охранный набор — 40 passed; полный backend — 282 passed / 50 файлов; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-W06 — Контракт единиц (Q-06, минимум)
Статус: DONE
Коммит: `fix(stock): enforce unit contract for norms and item units (Q-06)`
Что сделано:
- `stock.assertNormSane(unit, qty)`: норма > 2 для `kg`/`l` отклоняется с подсказкой в г/мл (D-15). Используется в `POST /stock/norms` и в `PUT /stock/recipes/:productId` (studio.ts).
- `stock.stockItemLinks(itemId)` — единый список ссылок (движения, партии, нормы, инвентаризации, накладные, заказы, возвраты, списания). Используется в `DELETE /stock/items/:id` и в новом запрете смены `unit` в `PATCH /stock/items/:id` (D-14). Отсутствующая таблица пропускается.
- UI: единица показывается рядом с количеством в форме норм (`Stock.tsx`), в строке рецептуры (`RecipesTab.tsx`) и в строке накладной (`Purchases.tsx`).
Тесты: `wh-units.test.ts` — 6 passed; полный backend — 288 passed / 51 файл; admin — 24 passed; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-W07 — Лимит платежа по долгу накладной (M-01)
Статус: DONE
Коммит: `fix(purchases): cap supplier payments by invoice debt (M-01)`
Что сделано:
- `POST /purchases/payments`: аллокации суммируются по накладной, проверяется `sum ≤ total_kop − paid_kop`; иначе 400 и транзакция откатывается (D-16). Проверка поставщика и статуса `posted` сохранена.
Тесты: `wh-payment-cap.test.ts` — 4 passed; `bank-row-pay.test.ts` в полном прогоне зелёный; полный backend — 292 passed / 52 файла; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-W08 — `received_qty` заказа растёт при проведении накладной (M-03)
Статус: DONE
Коммит: `fix(purchases): count order receipt at invoice posting, support partial receipt (M-03)`
Что сделано:
- Миграция `032_invoice_order_link.sql`: `purchase_invoices.order_id`, `purchase_invoice_lines.order_line_id` + индекс.
- `to-invoice`: читает необязательное тело `{ lines: [{ lineId, qty }] }` (ручное чтение, пустое тело допустимо), отклоняет создание при существующем черновике, проверяет `qty ≤ остатка строки`, пишет связки заказ↔накладная. Присваивания `received_qty = qty` и `status='closed'` удалены.
- `POST /purchases/invoices/:id/post`: в транзакции увеличивает `received_qty` строк заказа и выставляет статус заказа `closed`/`partial`.
Тесты: `wh-order-receive.test.ts` — 6 passed; полный backend — 298 passed / 53 файла; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-W09 — Точка в накладной, заказе и инвентаризации (U-01)
Статус: DONE
Коммит: `feat(stock): choose store in invoice, order and inventory forms (U-01)`
Что сделано:
- `GET /stock/stores` — список точек для форм.
- `normalizeStoreUuid` (экспорт из `stock.ts`): пустая строка → `null` («общий склад»), неизвестная точка → 400 «Точка не найдена». Применено в `POST /purchases/invoices`, `POST /purchases/orders`, `POST /inventory`.
- UI: компонент `StorePicker` + `defaultStoreUuid` в `shared.tsx`; подключён в форму накладной (`Purchases.tsx`), заказа (`OrdersTab.tsx`) и инвентаризации (`Inventory.tsx`), в тело уходит `storeUuid: value || null`.
Тесты: `wh-stores.test.ts` — 5 passed; полный backend — 303 passed / 54 файла; контрактный тест — 4 passed; admin — 24 passed; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-W10 — FEFO по точке и единый помощник списания (Q-08, Q-09)
Статус: DONE
Коммит: `refactor(stock): single store-aware FEFO helper, batch-linked inventory movements (Q-08, Q-09)`
Что сделано:
- Новый `modules/admin/stockFefo.ts` — `consumeFefo` (D-20: партии своей точки + общего склада; порядок срок→id; нехватка даёт движение без партии).
- `stockWriteOff` (продажа), проведение инвентаризации (`stock.ts`) и возврат поставщику (`studio.ts`) переведены на помощник. Инвентаризация: недостача идёт через FEFO, излишек создаёт партию и движение, привязанное к ней.
- Самостоятельных FEFO-запросов на списание вне `stockFefo.ts` не осталось (оставшиеся `FROM stock_batches` — чтение для экранов: остатки, сроки, себестоимость).
Тесты: `wh-fefo-store.test.ts` — 6 passed (включая инвариант `Σ движений = Σ qty_left`); полный backend — 309 passed / 55 файлов; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-W11 — Ручное списание, backend (Q-11)
Статус: DONE
Коммит: `feat(stock): manual write-off document with reasons (Q-11)`
Что сделано:
- Миграция `033_stock_writeoffs.sql`: `stock_writeoffs` + `stock_writeoff_lines` + индекс.
- `POST /stock/writeoffs` (причины spoilage/expired/staff/tasting/other, проверка точки, активности позиции, остатка `expectedQty`, суммирование одинаковых строк) — документ создаётся сразу как `posted` (D-22); списание идёт через `consumeFefo(kind='write_off')`.
- `GET /stock/writeoffs` — последние 100 документов со строками, названиями и единицами.
- `stock_writeoff_lines` добавлен в `stockItemLinks`: позиция со списанием деактивируется, а не удаляется.
Тесты: `wh-manual-writeoff.test.ts` — 7 passed; полный backend — 316 passed / 56 файлов; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-W12 — Ручное списание, UI (Q-11, U-05)
Статус: DONE
Коммит: `feat(admin): write-offs tab on the stock screen`
Что сделано:
- Новая вкладка «Списания» в экране «Склад» (`Stock.tsx` → `stock/WriteoffsTab.tsx`).
- Форма: точка (`StorePicker`), причина (Порча / Истёк срок / Персонал / Пробные / Прочее), строки «позиция + количество» с единицей позиции, комментарий, кнопка «Списать». Ошибка 400 показывается тостом с текстом сервера, после успеха перезагружается список.
- Список последних списаний: дата, точка, причина, позиции с количеством и единицей. Отмены и редактирования нет (D-22).
Тесты: admin — 24 passed; контрактный `contract-admin-routes.test.ts` — 4 passed (новые `/stock/writeoffs`, `/stock/stores` имеют обработчики); typecheck и build OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-W13 — Help: честные правила учёта (U-04)
Статус: DONE
Коммит: `docs(admin): update stock help to match write-off, unit and receipt rules`
Что сделано:
- Статья «Принципы учёта»: документы вместо правки ячейки, лимит оплаты долгом, норма в единице позиции и запрет смены единицы, FEFO с партиями точки, приёмка заказа по проведённой накладной.
- Статья «Как списывается кофе»: списание на любом чеке (с картой и без), возврат чека, вкладка «Списания», исторические чеки без карты, ошибка списания в «Спорах» (`stock_writeoff_failed`).
Тесты: typecheck OK; admin — 24 passed
Изменённые тесты: нет
DEFAULT-AD-HOC: название раздела «Споры» сверено с `Operations.tsx` (`label: 'Споры'`), замена не потребовалась.

## STEP-W14 — Полный прогон и `IMPLEMENTATION-WH-REPORT.md`
Статус: DONE
Коммит: `docs(stock): implementation report for warehouse W0-W2`
Что сделано: сквозной тест `wh-e2e.test.ts` (отдельный коммит `957d688`), полный прогон всех наборов, итоговый отчёт.
Тесты: backend 317 passed / 57 файлов; admin 24; PWA 52; typecheck OK; build OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

---

## Итог серии

Все 15 STEP выполнены. Backend: 248 → 317 тестов. Ничего не запушено.
