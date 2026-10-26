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
