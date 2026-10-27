# STEP-LOYALTY-BE-PROGRESS — backend / PWA (L-серия)

Источник: `PROMPTS-LOYALTY-BACKEND-SEQUENTIAL.md`, findings из `RESEARCH-LOYALTY-AUDIT-67-FINAL.md`.

## Базовая точка (STEP-B00)

| Параметр | Значение |
|---|---|
| Дата | 2026-10-27 |
| HEAD | `1ca194b` (main) |
| Ветка | `main` |
| `npm run typecheck` | OK, 3 пакета |
| backend | 318 passed / 57 файлов (`DB_PATH=/tmp/loy-be-base.db`) |
| PWA (frontend) | 52 passed / 4 файла |
| Незакоммиченные файлы | `AUDIT-6.7-COFFEE-CURRENT-STATE.md`, `RESEARCH-ADMIN-STUBS-STRATEGY.md`, `RESEARCH-LOYALTY-AUDIT-67-FINAL.md` (untracked, не трогаем) |

## STEP-B00 — Baseline
Статус: DONE
Коммит: `docs(loyalty): backend series baseline`
Что сделано: снят срез (typecheck, backend 318, PWA 52), создан файл прогресса.
Тесты: новых нет
DEFAULT-AD-HOC: нет

## STEP-B01 — Замок контракта token vs numeric (серверная страховка L-00)
Статус: DONE
Коммит: `test(loyalty): lock signed-token redeem vs numeric code no-redeem`
Что сделано: в `reservations.test.ts` добавлены три явных теста контракта:
- «numeric code in extras cannot spend free/cashback even when claimed» — чек заявляет `free=1, cb=3000`, но `c` — числовой код без `op`: `free_used=0`, кэшбэк цел, в `loyalty_ops` записан фактический ноль;
- «till reservation survives a SELL that used the numeric code» — бронь остаётся `RESERVED`;
- «signed token with reservation is the only redeem path» — `free_used=1`, бронь `CONSUMED`.
Продуктовый код не менялся: поведение уже верное, зафиксировано тестами и комментарием «L-00 contract».
Тесты: `reservations.test.ts` — 12 passed (было 9)
DEFAULT-AD-HOC: нет
