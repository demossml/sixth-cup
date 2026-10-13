# Словарь метрик 6.7 Coffee (админка)

| Метрика | Определение | Источник |
|---------|-------------|----------|
| Чеки SELL | Документы type=SELL | `evotor_docs` |
| С картой | SELL в `loyalty_ops` | `loyalty_ops` |
| Чашки | SUM cups_counted | `loyalty_ops` |
| Выручка ops | SUM result_rub | `loyalty_ops` — **не** полный отчёт Эвотор |
| Кэшбэк | cb / cashback_ledger | копейки |
| Quality | noPhoto, noCategory, noLink, noScheme | `/api/admin/catalog/quality` |

API: `GET /api/admin/analytics/series`, `GET /api/admin/analytics/by-store`.
