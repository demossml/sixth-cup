# CLEAN-AUDIT-SIXTH — инвентаризация перед чисткой

Дата: 30.10.2026. HEAD на входе: `16426e9` (`fix(admin): wipe-catalog returns 200 on partial Evotor push errors`).

## 0. Workspaces

| Пакет | Файлов TS/TSX (до) | Тестов |
|---|---|---|
| `backend` | 142 `src/**/*.ts` (из них 82 в `__tests__`) | 470 passed, 79 файлов |
| `frontend` (PWA) | 71 | 52 passed, 4 файла |
| `frontend-admin` | 54 | 33 passed, 7 файлов |
| Миграции | 37 SQL | — |

`npm run typecheck` (turbo, 3 пакета) — зелёный; `npm run build` — 3/3.

## 1. Markdown: путь → роль

### Корень (22 файла до чистки)

| Файл | Роль | Вердикт |
|---|---|---|
| `README.md` | витрина репозитория | оставить |
| `DEPLOYMENT.md` | деплой | оставить |
| `AGENTS.md` | правила для агентов | оставить (читается инструментами) |
| `ANDROID_INTEGRATION_CONTRACT.md` | контракт с кассой | оставить (запрещено трогать) |
| `GUIDE.md` | пошаговый билд-гайд (2365 строк, исторический) | оставить, помечен как устаревший |
| `CODE-AUDIT-2026-10.md`, `AUDIT-6.7-COFFEE-CURRENT-STATE.md` | аудиты | оставить (история решений) |
| `RESEARCH-ADMIN-STUBS-STRATEGY.md`, `RESEARCH-LOYALTY-AUDIT-67-FINAL.md` | исследования, разные темы (не дубли) | оставить |
| `ADDONS-ARCHITECTURE-AUDIT.md`, `ADDONS-DATA-FLOW.md`, `ADDONS-REGRESSION-TEST-PLAN.md` | материалы по добавкам | оставить |
| `FOLLOWUP-REPORT.md`, `IMPLEMENTATION-*.md` (5 файлов) | отчёты по сериям | оставить (на них ссылаются друг из друга) |
| `STEP-PROGRESS.md`, `STEP-WH-PROGRESS.md`, `STEP-LOYALTY-BE-PROGRESS.md`, `STEP-VCH-PROGRESS.md` | трекеры шагов серий, дублируют отчёты `IMPLEMENTATION-*` | **удалены** |
| `n.md`, `n2.md`, `n3.md` | вставленные логи сессий, **untracked и в .gitignore** | не трогали (вне репозитория) |

### `docs/` (36 файлов до чистки) — роли

- Контракты API: `DEVICE-CATALOG-API.md`, `DEVICE-SALES.md`, `CONTRACT-VOUCHERS-CASHIER.md`, `ADDONS-CASHIER-CONTRACT.md`, `CATALOG-VARIANTS-ADDONS.md`, `TZ-ADMIN-EVOTOR-SYNC-FULL.md`, `TZ-EVOTOR-FULL-v3.md` — оставлены.
- Лояльность: `LOYALTY-BACKEND-2026-10.md`, `LOYALTY-CHANNELS.md`, `LOYALTY-OBSERVABILITY.md`, `VOUCHERS-GIFTS-REFERRAL-2026-10.md` — оставлены.
- Эксплуатация: `EVOTOR-CABINET-SETUP.md`, `EVOTOR-TOKEN.md`, `EVOTOR-PROXY-STAGE1.md`, `PRODUCT-SYNC-EVOTOR.md`, `PRODUCT-IMAGES.md`, `PUSH.md`, `METRICS.md`, `P0-SECURITY-NOTES.md`, `SCAN-RECEIPT-RU.md` — оставлены.
- Дизайн PWA: `PWA-QR-FIRST.md`, `PWA-REDESIGN-RESEARCH.md`, `PWA-VISUAL-CONCEPT.md`, `PWA-UX-8-9.md`, `PWA-COMMERCIAL-POLISH.md`, `PWA-CLIENT-REDESIGN.md` — 6 итераций одного и того же; **удалён** только `PWA-CLIENT-REDESIGN.md` (чистый «что сделано», перекрыт остальными), остальные оставлены как история решений.
- Устаревшее: `EVOTOR-PHASE0-README.md` (фаза 0, факты уже в `EVOTOR-FACTS.md`), `ADMIN-PROD-TZ.md` (сам помечен `HISTORICAL NOTES`) — **удалены**.

## 2. Дубли кода

| Пара | Вывод |
|---|---|
| `backend/src/modules/catalog/addonScheme.ts` ↔ `frontend-admin/src/lib/addonScheme.ts` | разные пакеты, разные задачи (серверная сборка toppings vs UI-редактор). Не дубль, оставлено. |
| `backend/src/modules/loyalty/proof.ts` ↔ `frontend/src/lib/proof.ts` | серверная подпись vs клиентская проверка. Не дубль. |
| `backend/src/lib/crypto.ts` ↔ `frontend/src/lib/crypto.ts` | разные реализации (node crypto vs WebCrypto). Не дубль. |
| `*.bak`, `*copy*`, `*old*`, `*.orig` | не найдено ни одного файла |
| `frontend/src/copy/ru.ts` | i18n-модуль, несмотря на имя — используется в 3 страницах |

## 3. Файлы без входящих импортов (0-import graph)

Граф строился по всем `.ts/.tsx` пакета (разыменование относительных спецификаторов, `import()`, `require()`).

### backend/src — 3 источника без входящих импортов

| Файл | Вердикт |
|---|---|
| `index.ts` | точка входа сервера (`npm start`) — оставлен |
| `integrations/evotor/index.ts` | мёртвый barrel (никто не импортирует) — **удалён** |
| `integrations/evotor/types/payback.ts` | тип без использования — **удалён** |

Также удалены два типа, на которые ссылался только мёртвый barrel и `payback.ts`: `integrations/evotor/types/sell.ts`, `integrations/evotor/types/common.ts`.

### frontend/src — 9 мёртвых модулей

`components/BrandLogo.tsx`, `lib/dev.ts`, `lib/gameApi.ts`, `lib/gameQueue.ts`, `theme/tokens.ts`, `game/alpaca/entities/Bean.ts`, `game/alpaca/entities/Obstacle.ts`, `game/alpaca/systems/CollisionSystem.ts`, `game/alpaca/systems/ProgressSystem.ts` — все **удалены** (проверено: ни одного импорта, ни динамического, ни по имени символа).

`main.tsx` — точка входа, оставлена.

### frontend-admin/src — 0 мёртвых модулей

Все файлы достижимы из `main.tsx`/router; «сироты» в графе — только тесты (`*.test.ts`) и `main.tsx`.

## 4. Страницы и роуты

- `frontend/src/App.tsx`: все страницы из `pages/` подключены (проверено по router).
- `frontend-admin/src/App.tsx`: все страницы из `pages/` подключены.
- Компонентов с 0 импортов в `frontend-admin` нет.

## 5. Мёртвые export

Скан: экспорт, у которого 0 упоминаний вне своего файла и ≤1 внутри. Кандидатов много (типы, используемые только своим модулем), но удаление экспортов — шум без выгоды и риск для внешних потребителей (`backend` собирается как библиотека типов для скриптов). **Не трогали**, вынесено в «deferred».

## 6. Тесты

- `describe.skip` / `it.skip` / `test.skip` / `xit` в `backend/src/__tests__`, `frontend/src`, `frontend-admin/src` — **0**.
- Тестов-близнецов (одинаковое имя `it` + одинаковый модуль) не найдено; пересечения по смыслу есть у `vch-*` и `loyalty-*`, но они проверяют разные контракты.

## 7. Закомментированный код

Блоков комментариев длиннее 20 строк, содержащих код (`;`, `{}`) — **0**. Найденные два «длинных блока» оказались ложными срабатываниями (regex захватывал код между двумя инлайновыми комментариями): `staff/deviceRoutes.ts:17`, `pages/System.tsx:182`.

## 8. Дублирующие HTTP-обёртки

Проверены `frontend/src/api.ts`, `frontend-admin/src/api/client.ts`, `backend/src/lib/errors.ts`: один путь на пакет, дублей нет. Ничего не удалялось.

## Итог инвентаризации

| Метрика | До | После |
|---|---|---|
| `.md` в корне | 22 | 18 |
| `.md` в `docs/` | 36 | 33 |
| Мёртвых модулей кода | 13 | 0 (бэкенд 4, PWA 9) |
| Тестов | 470 + 52 + 33 | те же |
