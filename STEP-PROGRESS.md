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
