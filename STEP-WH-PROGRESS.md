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
