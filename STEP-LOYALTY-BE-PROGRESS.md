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

## STEP-B04 — L-06: atomic voucher redeem
Статус: DONE
Коммит: `fix(loyalty): atomic voucher redeem where used_at is null (L-06)`
Что сделано: в `modules/loyalty/receipts.ts` погашение ваучера идёт одним запросом
`UPDATE vouchers SET used_at=?, receipt_id=? WHERE id=? AND user_id=? AND used_at IS NULL`;
успех только при `changes === 1`, иначе спор `voucher_double_use`. Проверка владельца сохранена (`voucher_invalid`).
Тесты: `loyalty-voucher-redeem.test.ts` — 2 passed (второй чек не перезаписывает `receipt_id` и получает спор; чужой ваучер не погашается). Полный backend — 329 passed / 60 файлов.
DEFAULT-AD-HOC:
- **B04-1.** В тесте пришлось эмулировать подписанные чеки (ed25519 ключ устройства + `receiptId` вида `<deviceId>-…`) и шаг `q` = +2: после чека `cards.seq` становится `q+1`, поэтому соседний чек с `q+1` отбраковывается как `stale_receipt_sequence`. Это свойство контракта, не дефект.

## STEP-B05 — L-09: WELCOME honesty
Статус: DONE
Коммит: `fix(loyalty): WELCOME messaging matches real grant channels (L-09)`
Что сделано:
- `vouchers/service.ts`: `grantVoucherOnce` — идемпотентная выдача одним `INSERT … SELECT … WHERE NOT EXISTS (user_id, template_id)`, гонка двух каналов не создаёт дубликат.
- `SellHandler` (`handleSell`): WELCOME выдаётся на первой платной чашке через Эвотор (раньше — только online sale и receipt-sync, то есть гость, плативший только на кассе, не получал ничего). Отсутствие шаблона гасится `try/catch` и не роняет продажу.
- `devices/sales.ts` и `loyalty/receipts.ts` переведены на тот же хелпер: три канала теперь ведут себя одинаково.
- Копирайт менять не пришлось: обещания «10 % на первую покупку» в PWA/public нет, оно живёт только в названии шаблона `WELCOME`.
Тесты: `loyalty-welcome.test.ts` — 4 passed (выдача на первом чеке Эвотора, без дубля на втором, идемпотентность хелпера, отсутствие шаблона не ломает продажу). Полный backend — 333 passed / 61 файл.
DEFAULT-AD-HOC:
- **B05-1.** Постановка допускала «copy-only», но копирайта с обещанием нет, поэтому умолчание нечего смягчать. Вместо этого реализован безопасный идемпотентный grant — дефект закрыт по существу, а не замаскирован текстом.

## STEP-B06 — L-14′: copy from `cupsForFree`
Статус: DONE
Коммит: `fix(copy): loyalty threshold text from cupsForFree (L-14)`
Что сделано:
- `frontend/src/pages/InvitePage.tsx`: текст приглашения и пункт «как это работает» строятся как `каждый ${N+1}-й кофе`, где `N = me.cupsForFree ?? dir.cupsForFree ?? 5`.
- `frontend/src/copy/ru.ts`: фолбэк правил больше не утверждает «каждый шестой» — формулировка без числа («собрав нужное число, следующий напиток бесплатно»), потому что это статический текст без доступа к конфигу.
- `backend/src/modules/public/routes.ts`: фолбэк `legal_loyalty` собирается из `config.cupsForFree` («N оплаченных — следующий бесплатно»), значение из `app_settings` по-прежнему приоритетнее.
- `backend/src/db/seed.ts`: демо-промо «Каждый N+1-й стакан бесплатно» из конфига.
- `frontend/src/pages/GamePage.tsx`: дисклеймер про игровые показатели больше не ссылается на «шестой стакан».
Тесты: typecheck OK; backend — 333 passed; PWA — 52 passed; `grep "шест"` по PWA/public/seed даёт только комментарий.
DEFAULT-AD-HOC: нет

## STEP-B07 — L-08: PWA history минимально
Статус: DONE
Коммит: `feat(pwa): history shows cashback spend and referral reversal (L-08)`
Что сделано:
- `modules/sync/routes.ts`: в историю добавлены три новых типа строк — `cashback_spend` («Списано кэшбэком», `-cb`), `cashback_back` («Кэшбэк возвращён», `+cb` при PAYBACK) и `referral_reversal` («Возврат кэшбэка за друга», отрицательные `cashback_ledger`). Строка покупки по-прежнему берётся из `loyalty_ops` и не дублируется из `loyalty_ledger`.
- `HistoryPage.tsx`: отрицательный кэшбэк показывается красным; сумма покупки не подменяется списанием (это отдельная строка). Новые подписи приходят с сервера, отдельного словаря в PWA не потребовалось.
Тесты: `sync-history.test.ts` — 4 passed (покупка + списание отдельно, возврат кэшбэка, сторно referral, отсутствие дубля SELL). Backend — 335 passed / 61 файл; PWA — 52 passed.
DEFAULT-AD-HOC: нет
