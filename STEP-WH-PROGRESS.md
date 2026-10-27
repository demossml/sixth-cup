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
