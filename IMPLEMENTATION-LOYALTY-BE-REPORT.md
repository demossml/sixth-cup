# IMPLEMENTATION — Loyalty backend / PWA (L-серия)

| Поле | Значение |
|---|---|
| Дата | 2026-10-27 |
| HEAD до серии | `1ca194b` |
| HEAD после серии | `031e5cc` |
| Ветка | `main` |
| Push / deploy | не выполнялись |
| Источник | `PROMPTS-LOYALTY-BACKEND-SEQUENTIAL.md`, findings из `RESEARCH-LOYALTY-AUDIT-67-FINAL.md` |

## Таблица STEP

| STEP | Что | Коммит | Статус |
|---|---|---|---|
| B00 | Базовая точка и `STEP-LOYALTY-BE-PROGRESS.md` | `62b4226` | DONE |
| B01 | Контракт token vs numeric (L-00 страховка) | `415d38a` | DONE |
| B02 | Ретрай PAYBACK / FAILED (L-07) | `98f22b8` | DONE |
| B03 | Referral ledger = фактическое сторно (L-01) | `54d37a3` | DONE |
| B04 | Атомарное погашение ваучера (L-06) | `cd347f1` | DONE |
| B05 | WELCOME во всех каналах (L-09) | `65c27df` | DONE |
| B06 | Порог в копирайте из `cupsForFree` (L-14′) | `3f696df` | DONE |
| B07 | История PWA: списание и сторно кэшбэка (L-08) | `ac0155b` | DONE |
| B08 | Документ канальной эксклюзивности (L-02) | `5c2089a` | DONE |
| B09 | `pushEnabled` из реального флага (L-16) | `031e5cc` | DONE |
| B10 | Полный прогон, self-check, отчёт | этот коммит | DONE |

## Тесты

| Набор | До серии | После серии |
|---|---|---|
| backend | 318 / 57 файлов | **338 / 62 файла** |
| PWA (frontend) | 52 / 4 файла | 52 / 4 файла |
| `npm run typecheck` | OK (3 пакета) | OK (3 пакета) |
| `npm run build` | OK (3 пакета) | OK (3 пакета) |

Новые наборы: `loyalty-payback-retry.test.ts` (4), `loyalty-referral-floor.test.ts` (2),
`loyalty-voucher-redeem.test.ts` (2), `loyalty-welcome.test.ts` (4), `sync-history.test.ts` (4),
`public-content.test.ts` (3). Расширен `reservations.test.ts` (9 → 12).

## Self-check (STEP-B10)

```
[x] Numeric card code still cannot redeem free/cb
      → reservations.test.ts: «numeric code in extras cannot spend free/cashback even when claimed»,
        «till reservation survives a SELL that used the numeric code»
[x] Token redeem tests green
      → «signed token with reservation is the only redeem path»; 12 passed в файле
[x] PAYBACK retry when base SELL missing — tested
      → loyalty-payback-retry.test.ts (раньше SELL → PROCESSED, одно сторно; исчерпание → терминальный FAILED)
[x] Voucher double-redeem safe (changes===1)
      → receipts.ts: UPDATE … WHERE used_at IS NULL, changes!==1 → dispute voucher_double_use
[x] cupsForFree economy values NOT changed in config.ts
      → git diff 62b4226..HEAD -- backend/src/config.ts пустой
[x] WELCOME: either honest copy or idempotent grant — documented
      → grantVoucherOnce + выдача в SellHandler, online sale, receipt-sync; тест loyalty-welcome
[x] No APK/Kotlin changes in this repo for L-00
      → в диффе нет .kt/.java/apk; каталога APK в репозитории нет
[x] L-02 documented, no reckless migration
      → docs/LOYALTY-CHANNELS.md, без unique-индекса на истории
```

## Что изменилось по существу

- **L-07 (потеря данных).** `evotor_docs.next_retry_at` (миграция `034`), `scheduleRetry` / `failTerminal` /
  `retryPending` в `PollService`. Отложенные документы перечитываются из Cloud в окне ±6 ч, до 10 попыток,
  пауза 1 м → 5 м → 15 м → 1 ч. Ошибки данных закрываются сразу.
- **L-01 (учёт).** Сторно referral пишется на фактически снятую сумму; недобор — спор `referral_reversal_shortfall`.
  Баланс больше не уходит в минус и в ledger не появляется фантомный долг.
- **L-06 (ваучеры).** Погашение одним условным UPDATE; проигравший чек получает спор, а не «успех».
- **L-09 (WELCOME).** `grantVoucherOnce` + выдача на первой платной чашке в канале Эвотор — раньше
  гость, плативший только на кассе, не получал ваучер вообще.
- **L-08 (прозрачность).** В истории появились строки списания кэшбэка, возврата кэшбэка и сторно referral.
- **L-14′ / L-16 (копирайт и флаг).** Порог в текстах строится из `cupsForFree`; `pushEnabled` читает
  реальный флаг.

## Отложено (сознательно)

| ID | Почему не в этой серии |
|---|---|
| L-00 (redeem по числовому коду на кассе) | Закрывается в APK; backend-контракт зафиксирован тестами и ослаблять его запрещено |
| L-02 (общий ключ дедупа) | Нужен канонический фискальный идентификатор и миграционный план — документ готов, код не менялся |
| L-03 (единый резолвер чашек) | Требует продуктового решения по позициям без `counts_as_cup` |
| L-05 (частичное применение receipt-sync) | Нужно решение: атомарный отказ или частичное применение с честным результатом |
| L-10 (уникальность выдачи ваучера админом) | `grant-all` намеренно может выдавать повторно; менять семантику без запроса нельзя |
| L-12 / L-13 / L-15 | Сроки кэшбэка, путаница `counts_as_cup`/`free_eligible`, жизненный цикл споров — вне объёма серии |
| Ручной ±баланс в админке | По Defaults серии не делаем |

## Напоминание

Полный e2e списания на кассе по-прежнему зависит от **APK-серии (A01)** и последующего poll:
backend фиксирует контракт (только подписанный QR + резерв), но реальное списание проверяется на терминале.
