## Patch QR-first (после pwa-redesign-fixed)

- `frontend/src/pages/CardPage.tsx` — QR proof сразу на home, прогресс компактный.
- `frontend/src/components/Qr.tsx` — size/alt, errorCorrection M, светлый фон.
- `frontend/src/pages/CardQrPage.tsx` — только увеличение на весь экран.
- `docs/PWA-QR-FIRST.md`

Тапов до QR на кассе: **0** (после появления карты). Fullscreen — по желанию.


# REPORT — PWA 6.7 Coffee redesign

## Изменённые пути
- `backend/src/modules/sync/routes.ts` — `/api/sync/history`: JWT, limit 1–50, offset cursor; политика истории v1 — **B: история = ops + referral**. `loyalty_ledger` исключён, чтобы не дублировать продажу строкой прогресса/начисления.
- `frontend/src/App.tsx` — навигация «Карта / Меню / Ещё», подключены `/more`, `/history`, `/card-qr`.
- `frontend/src/pages/CardPage.tsx` — CTA fullscreen QR, stamps-first, убрать встроенный мелкий QR, состояние сети и stale.
- `frontend/src/pages/CardQrPage.tsx` — fullscreen QR подписанного proof, cardCode, offline timestamp, best-effort Screen Wake Lock.
- `frontend/src/pages/MorePage.tsx` — разделы истории, профиль, акции, приглашение.
- `frontend/src/pages/HistoryPage.tsx` — история с API, пустое состояние, кэш последней успешной загрузки, paging; кеш записывается из актуального массива после merge, повторяющиеся id при подгрузке не добавляются.
- `frontend/src/pages/MenuPage.tsx` — пометка времени каталога/stale.
- `frontend/src/components/InstallBanner.tsx` — не отображать баннер на fullscreen QR.
- `frontend/src/lib/app.tsx` — single-flight sync.
- `frontend/src/lib/icons.tsx` — экспорты иконок для новых экранов.
- `docs/PWA-CLIENT-REDESIGN.md` — техническая заметка и ручной checklist.
- `backend/src/__tests__/sync-history.test.ts` — проверка, что один SELL вместе с ledger progress даёт ровно один item с cupsDelta; проверка referral-строки.

## API и деньги
- `GET /api/sync/history?limit=30&cursor=` требует Bearer JWT. `cursor` — offset, `limit` ограничен 50.
- `cashback_balance`, `cashback_ledger.amount`, `loyalty_ledger.cashback_delta` хранят копейки. `loyalty_ops.result_rub` хранится/возвращается как рубли. История v1: только `loyalty_ops` (SELL/PAYBACK) + положительные referral-записи `cashback_ledger` по текущему beneficiary; строки `loyalty_ledger` не возвращаются.
- История не использует клиентские pending receipts.

## Контракты, которые не менялись
- `/api/auth/guest`, recovery/restore и существующий invite flow.
- Card QR payload остаётся `best.token` (подписанный proof), invite QR — invite URL.
- Evotor / SellHandler / `extras.sc` не менялись.
- `frontend-admin` и Android не менялись.

## Проверки
- `npm ci` — **не завершился в среде**: команда дважды завершилась `TransportTimeoutError`, локальные бинарники `turbo`, `tsc`, `vitest` не появились.
- `npm run typecheck` — **не гонялось**: зависимости не установлены.
- `npm run test -w backend` — **не гонялось**: `vitest` отсутствует после таймаута установки.
- `npm run build` — **не гонялось**: зависимости не установлены.

## Ограничения
- История добавлена на `/api/sync/history`, а не `/api/me/history`, чтобы использовать существующую JWT-защищённую группу sync без расширения корневого routing. Если нужно строго `/api/me/history`, можно перенести без изменения семантики.
- Cursor — ограниченный offset, а не keyset cursor; для небольшого стартового журнала это минимальная реализация, но при росте истории стоит перейти на keyset pagination.
- Статус `confirmed` формируется сервером для строк ops/referral, возвращаемых историей; клиентские pending receipts не включаются.
- Сборку и тесты нужно подтвердить перед production-деплоем.

## Область изменений / исключения
Изменены только `backend/src/modules/sync/routes.ts`, новый тест `backend/src/__tests__/sync-history.test.ts`, `frontend/src/pages/HistoryPage.tsx` и этот `REPORT.md`. `frontend-admin`, Android, `backend/src/integrations/evotor/processing/SellHandler.ts` и `extras.sc` не изменялись. Card QR payload (`best.token`) и invite flow не менялись.

## Self-score
- UX: 7/10 — реализованы ключевые потоки и навигация; нужны визуальная проверка на устройствах и refinement истории.
- Стабильность контрактов: 6/10 — боевые кассовые контракты не тронуты, но сборка/тесты не подтверждены в этой среде.
