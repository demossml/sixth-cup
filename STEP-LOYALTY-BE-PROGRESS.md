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

## STEP-B02 — L-07: PAYBACK / FAILED retry
Статус: DONE
Коммит: `fix(loyalty): retry PAYBACK when base SELL missing (L-07)`
Что сделано:
- Миграция `034_evotor_docs_retry.sql`: `evotor_docs.next_retry_at` + индекс. Статус остаётся `FAILED` (CHECK таблицы менять нельзя без пересоздания): `next_retry_at IS NOT NULL` = в очереди, `NULL` = окончательно.
- `PollService`: `scheduleRetry` / `failTerminal` / `retryPending`. Повтор перечитывает узкое окно Cloud (±6 ч от `close_date_ms`), потому что сырой документ не хранится (data minimisation). Попыток до `RETRY_MAX_ATTEMPTS = 10`, пауза `1м → 5м → 15м → 1ч`.
- Повторяются только «лечимые» причины (`base SELL not found`, исключения, документ не найден в окне). Ошибки данных (`card not found`, `card code not found`, `invalid signed card token`, `missing baseDocumentUUID`) закрываются сразу.
- Идемпотентность не менялась: сторно ограничено проверкой `loyalty_ops` и суммой базового чека.
Тесты: `loyalty-payback-retry.test.ts` — 4 passed (PAYBACK раньше SELL → PROCESSED после повтора и одно сторно; повтор не сторнирует дважды; исчерпание попыток → терминальный `FAILED` с `giving up`; ошибка карты в очередь не ставится). Полный backend — 325 passed / 58 файлов.
DEFAULT-AD-HOC:
- **B02-1.** Отдельный статус `RETRY` не вводился: CHECK-констрейнт `evotor_docs.status` не расширяется ALTER-ом, а пересоздание таблицы с историей — риск. Признак повтора вынесен в `next_retry_at`, как и предлагалось в постановке («вписаться в существующие колонки»).

## STEP-B03 — L-01: referral ledger vs MAX(0, balance)
Статус: DONE
Коммит: `fix(loyalty): referral reversal ledger matches balance floor (L-01)`
Что сделано: в `handlePayback` сторно referral теперь считает `actual = min(requested, balance)` и пишет в `cashback_ledger` **только фактически снятую** сумму (`-actual`) — и в `loyalty_ledger` тоже. Баланс больше не уводится в минус и не «обнуляется» фантомной строкой. Если `requested > actual`, пишется спор `referral_reversal_shortfall` с `{requested, actual, balance, payback}`.
Тесты: `loyalty-referral-floor.test.ts` — 2 passed (потраченный бонус → баланс 0, ровно одна строка `-500`, спор с requested 3000; нетронутый бонус → полное сторно, спора нет).
DEFAULT-AD-HOC:
- **B03-1.** `Σ cashback_ledger == баланс` не является инвариантом: таблица учитывает только referral-начисления и сторно, но не траты. Тест проверяет факт сторно и отсутствие фантомного долга, а не сумму по таблице.
