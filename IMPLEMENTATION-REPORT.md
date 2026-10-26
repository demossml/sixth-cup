# IMPLEMENTATION REPORT — admin gaps

| | |
|---|---|
| **Репозиторий** | `/Users/dmitrijsuvalov/Downloads/sixth-cup` (`demossml/sixth-cup`, ветка `main`) |
| **HEAD before** | `7e67a23` — `feat(admin): make the existing admin usable on phones` |
| **HEAD after** | `364ec59` — `chore: remove dead static existsSync; fix fixtures gitignore` (+ этот отчёт) |
| **Источник работ** | `PROMPTS-ADMIN-FIX-SEQUENTIAL.md` (STEP-00…STEP-12), `RESEARCH-ADMIN-STUBS-STRATEGY.md` (R-01…R-24) |
| **Push / deploy** | **не выполнялись** (по условию задачи) |
| **Вопросов пользователю** | не задавалось; спорные места решены по разделу Defaults и зафиксированы ниже |

## Итоговые проверки (STEP-12)

| Команда | Результат |
|---|---|
| `npm run typecheck` (turbo, 3 пакета) | **3/3 OK** |
| `npx turbo run build --force` | **3/3 OK** |
| `backend`: `DB_PATH=/tmp/final.db npx vitest run` | **246 passed / 45 файлов** (было 205 / 36) |
| `frontend-admin`: `npx vitest run` | **19 passed / 4 файла** (было 18 / 4) |
| `frontend` (PWA): `npx vitest run` | **52 passed / 4 файла** (без изменений) |
| `contract-admin-routes` (в составе backend) | 4 passed — ни один клиентский вызов не остался без обработчика |
| Smoke статики в `NODE_ENV=production` | `/` → 200, `/menu` → 200, admin-host `/` → 200, хешированные ассеты → 200, `/classic.html` → 404, `/api/admin/meta` → 200 |
| Живая проверка UI на превью `http://admin.localhost:3970` | юрлица, устройства, «Провести оплату», CSV/удаление сверки, номенклатура, счётчики инвентаризации, переименование сотрудника — работают |
| Горизонтальное переполнение | 390 и 1440 px на 8 изменённых экранах — 0 случаев |

## Commits

| # | Hash | Message |
|---|---|---|
| 1 | `ca503cb` | chore(ci): workflow + admin route contract test |
| 2 | `bef7fa8` | fix(admin): help text reflects bank and recon tabs |
| 3 | `dc5d0f7` | feat(purchases): bank-row pay creates purchase_payments (R-01 backend) |
| 4 | `941a1f2` | feat(admin): bank tab pay button (R-01) |
| 5 | `8327062` | feat(purchases): recon delete and csv export (R-14) |
| 6 | `e0c5786` | fix(evotor): respect product_store_links.enabled on enqueue/push (R-02) |
| 7 | `3ad1513` | feat(admin): edit and delete suppliers (R-03) |
| 8 | `c8f2de3` | feat(admin): organizations management UI (R-04) |
| 9 | `f5e4832` | feat(admin): cash devices enroll/revoke UI (R-05) |
| 10 | `411ef10` | feat(staff): patch staff + admin UI (R-07) |
| 11 | `6a63c49` | feat(stock): item edit/delete and inventory overview wiring (R-08/R-09) |
| 12 | `364ec59` | chore: remove dead static existsSync; fix fixtures gitignore |

Один STEP ≈ один коммит; итог: 30 изменённых файлов, +2245/−70, 11 новых файлов (из них 9 — тесты, 1 миграция, 1 CI-воркфлоу).

## STEPs completed

| STEP | Задача | Статус | Новые/изменённые тесты | Заметки |
|---|---|---|---|---|
| 00 | CI + контракт client↔routes | DONE | `contract-admin-routes.test.ts` (4) | strict-режим по снимку orphan-эндпоинтов выключен по умолчанию |
| 01 | R-15: Help про Банк/Сверки | DONE | — (typecheck) | текст теперь описывает фактические вкладки |
| 02 | R-01 backend: миграция + `POST /purchases/bank-rows/:id/pay` | DONE | `bank-row-pay.test.ts` (7) | идемпотентность по `bank_rows.payment_id`, гонка → 409 |
| 03 | R-01 UI: «Провести оплату» | DONE | `BankTab.test.ts` (+1 → 8) | после оплаты обновляются долги на соседней вкладке |
| 04 | R-14: DELETE сверки + CSV акта | DONE | `recon-delete-csv.test.ts` (4) | CSV с BOM/экранированием через общий `toCsv` |
| 05 | R-02: адресная выгрузка по `enabled` | DONE | `product-store-enabled-push.test.ts` (4) | нет строки в links → выгружается (совместимость) |
| 06 | R-03: правка/удаление поставщика | DONE | `suppliers-crud.test.ts` (5) | удаление с документами → деактивация + причина, не 500 |
| 07 | R-04: юрлица в админке | DONE | `organizations-crud.test.ts` (3) | вкладка «Юрлица» в `System`, `?tab=orgs` |
| 08 | R-05: устройства кассы | DONE | `devices-admin.test.ts` (5) | код регистрации показывается один раз |
| 09 | R-07: `PATCH /staff/:id` + UI | DONE | `staff-admin.test.ts` (5) | первый тест на staff-admin вообще |
| 10 | R-08/R-09: склад + инвентаризация | DONE | `stock-items-inventory.test.ts` (4) | удаление с движениями → деактивация, не 500 |
| 11 | R-23/R-24: гигиена | DONE | smoke-тест статики (ручной) | мёртвый `existsSync` удалён, `.gitignore` исправлен |
| 12 | Финальный прогон + отчёт | DONE | — | этот файл |

## Что изменилось в поведении (для ревьюера)

1. **Банк → деньги.** Привязка строки выписки к накладной сама по себе долг не меняет; появилась явная кнопка «Провести оплату», которая создаёт `purchase_payments` + аллокацию + увеличивает `paid_kop` и помечает строку `payment_id`. Повторный клик идемпотентен.
2. **Сверки.** Появились удаление и CSV акта; цифры (оборот, оплаты, наш долг, расхождение) считаются как раньше — из накладных и платежей.
3. **Выгрузка каталога.** Товар уходит только на точки, где он разрешён галочкой; товары без строк в `product_store_links` по-прежнему выгружаются на все sync-точки.
4. **Справочники.** Поставщики, юрлица, устройства, номенклатура склада и сотрудники теперь редактируются/удаляются из интерфейса. Удаление «связанной» сущности больше не даёт 500: сервер выключает объект и объясняет причину.
5. **Инвентаризация.** В списке документов видно «посчитано N из M».
6. **Инфраструктура.** Есть CI (typecheck + build + три набора тестов) и контрактный тест, который падает, если админка вызовет несуществующий эндпоинт.

## Defaults applied (из PROMPTS)

| Вопрос | Принятое решение | Где видно |
|---|---|---|
| Снятие галочки «продаётся на точке» | новые изменения не выгружаются; существующая позиция в облаке не удаляется, `allow_to_sell` не переключается | `ProductPushService.productEnabledForStore`, тест `product-store-enabled-push` |
| Товар без строк в `product_store_links` | считается `enabled=1` (выгружается как раньше) | там же |
| Orphan analytics endpoints | не удалялись | — |
| Web Push / `/devices/sales` | не трогались | — |
| Роли для банка | как у `POST /purchases/payments` (owner/manager; viewer → 403) | `adminAuth` + тест «без токена → 403» |
| `EVOTOR_PROXY_ENFORCE` | не включался | — |
| Удаление справочника с документами (не описано в Defaults) | **безопасный выбор**: деактивация вместо 409/500, чтобы не терять историю и не ломать FK | `stock.ts` (suppliers, stock items) |

## Regressions found and fixed during work

| Что | Как проявилось | Как исправлено |
|---|---|---|
| `createInvoice` случайно вырезан из `Purchases.tsx` при удалении дублирующего блока создания поставщика | `tsc`: `Cannot find name 'createInvoice'` | функция восстановлена полностью, диф содержит только удаление `createSupplier/sName/showSupplier` |
| Тело `POST …/pay` было обязательным JSON | пустой POST → 400 «Malformed JSON» | тело читается вручную, пустое допустимо; невалидный JSON → 400 с понятным текстом |
| `:id.csv` в Hono кладёт параметр под ключом `id.csv` | CSV отдавал 400 «Invalid id» | чтение `c.req.param('id.csv')` + комментарий в коде |
| `reconRows()` не отдавал `notes` | CSV не компилировался | тип расширен, поведение прежнее |
| Производственный smoke: `/` отдавал 404 | оказалось — на :3000 висел dev-процесс без `NODE_ENV`; после корректного запуска всё 200 | проверено повторно, ложная тревога зафиксирована |
| `.gitignore` скрывал `src/**/__fixtures__` | локальный дамп `sell-sample.json` стал бы «невидимым» при переносе | дамп перемещён в игнорируемый `backend/data/fixtures/`, правило для `src` удалено |

Откатов STEP не потребовалось: каждый шаг заканчивался зелёными typecheck + тестами.

## NOT done (explicit)

- **R-20 Web Push** — не реализован (нет VAPID/продуктового решения).
- **R-21 `EVOTOR_PROXY_ENFORCE`** — не включался (требует настройки прокси в кабинете Эвотор; отдельный ops-шаг).
- **R-18 `POST /api/devices/sales`** — контракт не менялся, решение за продуктом.
- **Orphan-аналитика** (`/analytics/staff|affinity|customers|window|compare`, `/referrals/pairs`, `/overview`, `/sales/summary`, `/loyalty/ops`, `/cashback/:userId`, `/purchases/snapshot`, `/stock/snapshot|consumption`, `/inventory/:id/sheet|meta`, `/modifiers/backfill-products`) — не удалялась и не выводилась в UI.
- **Локальные `stores` UI (R-12)**, шаблоны ваучеров (R-06), файловый импорт выписки (R-13) — вне этих STEP.
- **`evotor-app`** — не открывался на запись; никаких изменений в APK.
- **API-контракт device catalog** не менялся (`menu`, `articleNumber`, `hidden` — как было).
- **`modifiers`** не получил `evotor_uuid` (анти-паттерн из промпта соблюдён).
- **Push, deploy, force-push** не выполнялись.

## How to verify bank pay manually

1. Поднять backend на временной БД:
   `cd backend && PORT=3970 DB_PATH=/tmp/sc-admin/sixth-cup.db UPLOADS_DIR=/tmp/sc-admin/uploads ADMIN_TOKEN=admin-67 JWT_SECRET=preview-secret NODE_ENV=production npx tsx src/index.ts`
2. Открыть `http://admin.localhost:3970/#/purchases?tab=invoices` → «Накладная» → создать накладную (поставщик + позиция склада + сумма) → «Провести».
3. Вкладка **«Банк»** → вставить строку выписки `2026-10-26; <имя поставщика>; Оплата по счёту; <сумма>` → «Загрузить».
4. В колонке «Сопоставление» выбрать накладную в селекте «привязать к накладной…».
5. Появится кнопка **«Провести оплату»** → нажать. Ожидаемо: тост «Оплата проведена — долг уменьшился», бейдж «оплачено».
6. Вкладка **«Долги»**: сумма по поставщику уменьшилась на сумму строки (или на остаток долга).
7. Вкладка **«Сверки»**: создать сверку за период → «Наш долг» уже учитывает платёж; «CSV» скачивает акт; «Удалить» убирает сверку (накладные и оплаты остаются).
8. Повторное нажатие «Провести оплату» (если строка ещё не помечена) даёт `idempotent: true` и не создаёт второй платёж — проверено и тестом, и живым запросом.

## Ограничения проверки

- Всё проверено на **изолированной/превью БД**; production-данные не затрагивались.
- Evotor Cloud и терминал не использовались: интеграционные шаги (реальная выгрузка, чек, начисление) остаются `UNVERIFIED`, как и в аудите.
- UI проверялся в Chromium (390 и 1440 px); Safari/iOS не проверялись.
- CI-воркфлоу создан, но в этом окружении не запускался (нет GitHub Actions локально) — эквивалентные шаги прогнаны вручную.
