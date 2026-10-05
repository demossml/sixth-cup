# EVOTOR-FACTS (Phase 0)

Заполнять по результатам `scripts/evotor-probe.ts` и прототипа APK.

| № | Результат | Дата | Комментарий |
|---|-----------|------|-------------|
| 0.1 token | ✅ OK | 2026-10-05 | фиксированный токен в `.env`; `stores/search` → HTTP 200, массив из 4 магазинов |
| 0.1 employees | ✅ OK | 2026-10-05 | `employees/search` → HTTP 200, 9 сотрудников |
| 0.2 V2 headers | ℹ️ не требуется | 2026-10-05 | схема v1 (`/api/v1/inventories/*`), заголовок `X-Authorization`; Accept не обязателен |
| 0.3 SELL sample | ✅ есть | 2026-10-05 | `src/integrations/evotor/__fixtures__/sell-sample.json` (ПДн не содержит) |
| 0.4 fields present | ✅ | 2026-10-05 | поля в `transactions[]`, НЕ `body.positions`; `extras` = `{}` (пусто в API) |
| 0.5 product write | | | |
| 0.6 extras in GET documents | ⚠️ extras пуст | 2026-10-05 | `extras: {}` в SELL — loyalty-`sc` из APK не виден; см. Branch 0.6 |
| 0.7 extra size | | | |
| 0.8 ReceiptDiscountEvent | | | |
| 0.9 PAYBACK base_document_id | ✅ | 2026-10-05 | `PAYBACK` есть в 7-дневке; структура как SELL + `baseDocumentUUID` |
| 0.10 offline delay | | | |
| 0.11 webhook | | | |
| 0.12 429 | | | |

### Ключевые факты API v1 (проверено 2026-10-05)

- **Даты**: `gtCloseDate` / `ltCloseDate` принимают только `YYYY-MM-DD` (без времени — иначе HTTP 400 `invalid_format`). `ltCloseDate` **исключительная** граница → для «сегодня» отдавать завтрашнюю дату.
- **Магазины**: `stores/search` вернул 4 магазина. Документы отдаются только для магазинов, где приложение **оплачено/установлено на всех устройствах**:
  - `Победа` (…E6831) — OK, 659 документов за 7 дней
  - `Мой магазин` (…8488) — OK, 3 документа
  - `Твардоского` (…A33B) — HTTP 402 «application is not paid/installed on all devices»
  - `45` (…1138E) — HTTP 402 «application is not paid/installed on all devices»
- **Типы документов** за 7 дней: `OPEN_SESSION`, `SELL`, `CASH_OUTCOME`, `CLOSE_SESSION`, `FPRINT`, `PAYBACK`.
- **SELL** содержит `transactions[]` (DOCUMENT_OPEN, REGISTER_POSITION, POSITION_TAX, PAYMENT, DOCUMENT_CLOSE_FPRINT, DOCUMENT_CLOSE), `closeSum`/`closeResultSum`, `storeUuid`, `deviceUuid`, `extras: {}`.

## Branch 0.6

- [ ] (a) extras/sc visible in API document — **пока extras = {}** (не виден)
- [ ] (b) fallback field for `op`
- [ ] (c) STOP — no loyalty without redesign

## Decision log

- 2026-10-05: схема **фиксированный токен v1** (workApp-стиль) — без webhook `/user/token`/verify/push.
- 2026-10-05: исправлен формат дат (`YYYY-MM-DD`, `lt` = следующая дата) по результатам 400 на времени.
