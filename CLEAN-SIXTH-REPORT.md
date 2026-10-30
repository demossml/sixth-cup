# CLEAN-SIXTH-REPORT — итог чистки

Дата: 30.10.2026. Ветка `main`. Инвентаризация — `CLEAN-AUDIT-SIXTH.md`.

## Удалено (20 файлов)

### Код — backend (4 файла, мёртвые типы и barrel)

| Файл | Почему |
|---|---|
| `backend/src/integrations/evotor/index.ts` | barrel, который никто не импортирует (0 входящих ссылок) |
| `backend/src/integrations/evotor/types/common.ts` | ссылался только мёртвый barrel |
| `backend/src/integrations/evotor/types/payback.ts` | `EvotorPaybackBody` не используется нигде |
| `backend/src/integrations/evotor/types/sell.ts` | `EvotorSellBody` использовался только в `payback.ts` |

### Код — PWA (9 файлов, 0 импортов)

| Файл | Почему |
|---|---|
| `frontend/src/components/BrandLogo.tsx` | ни одного импорта (упоминание осталось только в комментарии `MorePage.tsx`) |
| `frontend/src/lib/dev.ts` | `isDev`/`DevUser` не используются |
| `frontend/src/lib/gameApi.ts` | `gameFetch`/`gameApi` не вызываются |
| `frontend/src/lib/gameQueue.ts` | офлайн-очередь наград игры не подключена |
| `frontend/src/theme/tokens.ts` | палитра-зеркало никем не импортируется |
| `frontend/src/game/alpaca/entities/Bean.ts` | `BeanDef` не используется |
| `frontend/src/game/alpaca/entities/Obstacle.ts` | `CrateDef`/`OverheadDef` не используются |
| `frontend/src/game/alpaca/systems/CollisionSystem.ts` | `overlap()` не вызывается |
| `frontend/src/game/alpaca/systems/ProgressSystem.ts` | `distanceProgress()` не вызывается |

### Markdown (7 файлов)

| Файл | Почему |
|---|---|
| `STEP-PROGRESS.md`, `STEP-WH-PROGRESS.md`, `STEP-LOYALTY-BE-PROGRESS.md`, `STEP-VCH-PROGRESS.md` | трекеры шагов серий, дублируют итоговые `IMPLEMENTATION-*-REPORT.md` |
| `docs/EVOTOR-PHASE0-README.md` | фаза 0, факты уже в `docs/EVOTOR-FACTS.md` |
| `docs/ADMIN-PROD-TZ.md` | сам помечен `HISTORICAL NOTES: current contract in README.md и docs/PRODUCT-SYNC-EVOTOR.md` |
| `docs/PWA-CLIENT-REDESIGN.md` | перекрыт другими PWA-документами (visual concept / UX 8-9 / redesign research) |

## Отложено (deferred), с причинами

| Что | Почему не тронули |
|---|---|
| Мёртвые `export` (≈36 кандидатов: `AppType`, `TaxRegime`, `newest`, `discountFor`, `ProductGroup`, `Promo` и др.) | удаление ключевого слова ничего не даёт в рантайме; часть типов используется внешними скриптами/тестами; риск > выгоды |
| 5 PWA-документов (`PWA-QR-FIRST`, `PWA-REDESIGN-RESEARCH`, `PWA-VISUAL-CONCEPT`, `PWA-UX-8-9`, `PWA-COMMERCIAL-POLISH`) | это история дизайн-решений, а не дубли одного текста; удалять без владельца — потеря контекста |
| `GUIDE.md` (2365 строк, пошаговый билд со вставленным кодом) | устарел относительно текущего кода, но это единственный «как собрать с нуля»; помечен как устаревший, удаление — решение владельца |
| `AUDIT-6.7-COFFEE-CURRENT-STATE.md`, `CODE-AUDIT-2026-10.md`, `RESEARCH-*`, `IMPLEMENTATION-*` | аудиты и отчёты, на них ссылаются другие документы и промпты |
| `frontend/src/game/alpaca/entities/Alpaca.ts` → `heroDebugRect` | файл живой, мёртвый только один экспорт |
| Дубли `addonScheme.ts` (backend ↔ admin), `proof.ts`, `crypto.ts` | не дубли: разные рантаймы и задачи |
| `n.md`, `n2.md`, `n3.md` в корне | не в репозитории (untracked + `.gitignore`), удаление локальных логов — не наше решение |
| Миграции SQL | запрещено промптом |

## Проверка

| Проверка | Результат |
|---|---|
| `npm run typecheck` (turbo, 3 пакета) | **OK** |
| `npm run build` (turbo, 3 пакета) | **OK** |
| backend весь набор | **470 passed / 79 файлов, 0 падений** |
| targeted: `admin-console admin-audit-fixes device-catalog addons-e2e addons-milk-scheme addons-catalog-regressions` | **56 passed / 6 файлов** |
| frontend (PWA) | **52 passed / 4 файла** |
| frontend-admin | **33 passed / 7 файлов** |
| `GET /api/devices/catalog`, loyalty resolve, addons, wipe-catalog, admin auth | не менялись (ни одной правки в этих файлах) |

## Коммит

`chore: remove dead code and stale markdown`

Push не выполнялся — по команде владельца.
