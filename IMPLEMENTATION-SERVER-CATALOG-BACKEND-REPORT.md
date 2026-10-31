# IMPLEMENTATION-SERVER-CATALOG-BACKEND-REPORT

Фаза 1 плана server-driven addons (backend). HEAD на входе: `7b30c45` (main). Пуш — по слову владельца.

## Что сделано по шагам

| STEP | Итог |
|---|---|
| **B0** | Зафиксировано: catalog handler `backend/src/modules/devices/routes.ts` (`GET /catalog`, ~285), сборка toppings `backend/src/modules/catalog/addonScheme.ts` (`buildCatalogToppings`), uuid-карта из `product_store_links` (строго по storeUuid), `hideFromMenu/isModifier` из `modifierProductIds`, `groups[]` из `product_groups` (без toppings — как в проде). Baseline: typecheck OK, backend 486 passed / 81 файл |
| **B1** | В `products[]`: `sellable`, `notReadyReason` (`hidden_modifier` / `unavailable` / `no_store_link` / `no_evotor_uuid`). В `toppings[]`: `notReadyReason` (`no_evotor_uuid` / `unavailable`, для zeroOption — `null`). В корне: `features.serverCatalog` (default **false**; true при `?serverCatalog=1` или `X-App-Version-Code ≥ 140`) и `notReadySummary` (≤50). Позиции из `products[]` **не удаляются** |
| **B2** | uuid добавок — только из связей запрошенной точки; добавлен отдельный запрос «связь есть, uuid пуст» (иначе после wipe причина была бы `no_store_link`). Тест на две точки с разными uuid и на точку без связей |
| **B3** | `docs/DEVICES-CATALOG-SERVER-MODE.md` — контракт на 1 экран |
| **B4** | Только API: `GET /api/admin/products` отдаёт `evotorReady` + `evotorReadyReason` (`no_store_link` / `no_evotor_uuid` / `last_push_failed`). UI — фаза 2 |
| **B5** | Self-check ниже |

## Self-check (B5)

- [x] Старый APK не ломается: все поля аддитивные, `features.serverCatalog=false` по умолчанию, `products[]` не чистится
- [x] `features.serverCatalog` default `false`
- [x] `zeroOption` без uuid — доступна, в чек не идёт (политика кассы не тронута)
- [x] uuid добавок per storeUuid (тест с двумя точками)
- [x] GUARD `addons-e2e + addons-milk-scheme + addons-catalog-regressions + addons-category-dedupe + device-catalog + admin-console + admin-audit-fixes + server-catalog` — **69 passed / 8 файлов**
- [x] Полный backend: **496 passed / 82 файла, 0 падений**; `typecheck` (3 пакета) OK

## Файлы

| Файл | Что |
|---|---|
| `backend/src/modules/devices/routes.ts` | `sellable`, `notReadyReason`, `linkedToStore`, `features`, `notReadySummary` |
| `backend/src/modules/catalog/addonScheme.ts` | `notReadyReason` в `CatalogTopping` и в обеих ветках сборки |
| `backend/src/modules/admin/routes.ts` | `evotorReady` / `evotorReadyReason` в списке товаров |
| `backend/src/__tests__/server-catalog.test.ts` | новый, 10 тестов |
| `backend/src/__tests__/fixtures/addons-catalog-fixture.json` | регенерация: только добавленные поля (`sellable`, `notReadyReason`); удалённых строк — 0 по смыслу (18 строк `"available": true` стали `"available": true,` + `notReadyReason`) |
| `docs/DEVICES-CATALOG-SERVER-MODE.md` | новый контракт |

## Не делали (осознанно)

- Фаза 2 (UX админки «Молоко/Добавки») — отдельный пакет.
- `sellable=false` не скрывает позиции из JSON (F2) и не влияет на PWA-каталог.
- Loyalty, poll, wipe, fiscal — не тронуты.
- APK — отдельный промпт (`PROMPTS-SERVER-DRIVEN-ADDONS-APK.md`), здесь только поле-флаг и контракт.

## Риски

- `sellable` считается по `available` **товара** (глобально) + наличию uuid точки; наличие uuid в номенклатуре терминала проверяет APK (`missing_on_terminal`).
- `notReadySummary` ограничен 50 записями — при массовых проблемах смотреть `products[]` целиком.
