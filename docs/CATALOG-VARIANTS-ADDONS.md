# Каталог кассы, объёмы, добавки и Эвотор — исследование

**Дата:** 2026-10-25
**Режим:** только исследование. Код, БД, настройки, касса, git-история не изменялись; коммитов и пушей нет.
**Репозитории:**

| Репо | Ветка | HEAD | origin/main | Рабочее дерево |
|---|---|---|---|---|
| `sixth-cup` (`~/Downloads/sixth-cup`) | main | `b42d099` → `aadb8a0` (см. примечание) | `aadb8a0` | чисто по трекаемым; untracked `n.md`, `n2.md`, `n3.md` (не мои) |
| `evotor-app` (`~/Documents/evotor-app`) | main | `1661199` | `1661199` | чисто |

> **Примечание о конкурентных изменениях.** Пока шло исследование, в `sixth-cup` появились посторонние коммиты (`307c015`, `aadb8a0` — админка закупок/банка). Проверено: `git diff b42d099..HEAD -- backend/src/modules/catalog backend/src/modules/devices backend/src/integrations backend/src/db frontend-admin/src/pages/MenuProducts.tsx frontend-admin/src/pages/MenuGroups.tsx` — **пусто**, то есть все анализируемые файлы и номера строк актуальны. HEAD `b42d099` зафиксирован на момент начала чтения кода.

**Собранный APK в этом окружении:** `ru.sixthcup.evotor`, `versionCode=115`, `versionName=5.1.0-addons-contract`, `API_BASE_URL=https://app.67coffee.ru`, `STORE_UUID=""` (пусто).

**Метод и границы доказательств:**

- `[Код]` — вывод из чтения исходников с точной ссылкой `файл:строка`.
- `[Данные]` — SELECT-ы на **копии** `backend/data/sixth-cup.db` (копия лежит в `/tmp`, оригинал не изменялся).
- `[API]` — вызов `GET /api/devices/catalog` приложением, поднятым **против копии БД** (не прод, не рабочая база).
- `[Не проверено]` — требует доступа к тестовой кассе, её backend-БД или прод-окружению; в этом окружении недоступно.

Локальная БД не является базой тестовой кассы: в ней `evotor_stores = 0`, `evotor_products = 0`, `evotor_outbox = 0`, `evotor_sync_log = 0`, клиентских логов кассы нет. Поэтому фактические данные кассы проверить нельзя (см. раздел L).

---

## A. Краткое резюме

**Что действительно работает (доказано):**

1. Backend **сам по себе** помечает добавки правильно: `isModifier=true`, `hideFromMenu=true`; папки Эвотор (`is_group=1`) — `isGroup=true`, `hideFromMenu=true` `[API]` `[Код: devices/routes.ts:441,444]`.
2. Каталог отдаёт `groupId`, `variantLabel`, `sizeValue/sizeUnit`, `parentProductId`, `hideFromMenu` по каждому товару и массив `groups[]` с вариантами `[Код: devices/routes.ts:429-483]`.
3. Корзина и чек берут **uuid выбранного варианта** и добавляют платные добавки отдельными позициями только при наличии `evotorUuid` `[Код: MainActivity.kt:1181-1196, SellLauncher.kt:45-90]`.

**Что сломано / является причиной симптомов:**

| # | Проблема | Тип |
|---|---|---|
| **E1** | Скрытие добавок на кассе держится **только** на флагах backend, сопоставленных по `evotorUuid` или по имени. Нет ни стабильного id, ни клиентского правила «нет в каталоге/категория Добавки → не плитка». Любой промах сопоставления → добавка видна. | код |
| **E2** | Backend определяет добавку по **имени категории** («содержит „добавк“») и берёт **только первую** такую категорию (`resolveAddonsCategoryId`), хотя в коде признано, что категорий-добавок может быть несколько. Товары во второй категории не скрываются. | код |
| **E3** | В локальной БД лежат **тестовые артефакты**, созданные до изоляции тестов (`c2396d4`): 4 товара «орех-ТЕСТ» **вне** категории «Добавки» (возвращаются каталогом как обычные: `hide=false`), 5 отдельных товаров «Капучино-тест 200 мл», каждый в **своей** группе. | данные |
| **F1** | Группировка объёмов на кассе — **виртуальная**: Эвотор получает N обычных товаров, признака «размер» в Эвоторе нет. Группировка работает, только если сработал `groupId` от backend **или** имя заканчивается на «N мл». | код + архитектура |
| **F2** | APK **игнорирует** документированный контракт `groups[]` (в клиенте нет ни одного чтения `groups`) — вся группировка держится на `groupId` внутри каждого `products[]`. | код |
| **F3** | Если варианты в БД лежат по одному в разных `product_groups` (как тестовые «Капучино-тест»), клиент получает разные `admin-group:N` и рисует N плиток — даже при полностью рабочем backend. | данные + код |
| **D1** | `PUT /products/:id/stores` (кнопка сохранения в карточке товара админки) **не существует** в backend → 404; витринная доступность по точкам из карточки не сохраняется. | код |
| **D2** | `product_store_availability` учитывается только в каталоге, но **не влияет на выгрузку в Эвотор** (`allow_to_sell` считается только из глобального `available`). Товар, выключенный для точки, остаётся продаваемым на кассе и выпадает из каталога → его флаги скрытия теряются. | код |
| **D3** | Добавки выгружаются в Эвотор как **обычные sellable-товары** внутри папок; «папка» в Эвотор не скрывает их с витрины APK (APK вообще не рисует папки, только раскладывает по `groupName`). | архитектура |
| **D4** | Версия APK на кассе неизвестна. Скрытие добавок появилось в `4.9.6-hide-modifiers` (`f40f4ac`), группировка по admin-группам — в `4.9.3`/`4.9.13`. На более старой сборке оба симптома ожидаемы. | окружение |

Итог: **симптомы объясняются комбинацией «данные + хрупкое сопоставление + отсутствие клиентского запасного правила»**, а не одним дефектом backend. Backend-каталог формально корректен; гарантии «добавка никогда не станет плиткой» в системе нет.

---

## B. Карта архитектуры (полный путь данных)

| # | Этап | Файл / функция | Вход | Выход | Идентификаторы | Фильтры |
|---|---|---|---|---|---|---|
| 1 | Создание/редактирование товара в админке | `frontend-admin/src/pages/MenuProducts.tsx:179` → `POST /api/admin/products` → `backend/src/modules/admin/routes.ts:480` | форма | строка `products` | `products.id` (автоинкремент) | `available`, `season_*` |
| 2 | Группы товаров (витринные) | `MenuProducts.tsx:151` → `POST /api/admin/product-groups` → `admin/routes.ts:630-760` | name + variants[] | 1 строка `product_groups` + N строк `products` с `group_id` | `product_groups.id`, `products.group_id` | — |
| 3 | Объёмы/варианты | `admin/routes.ts:686-724` | `variants: [{label, price, sizeValue, sizeUnit}]` | SKU: `name = "<группа> <label>"`, `variant_label`, `variant_sort`, `size_value` | `products.id`, `group_id`, `evotor_uuid` (после синка) | `available` |
| 4 | Создание добавки и категория | `MenuGroups.tsx` (Modifiers) → `POST /api/admin/modifiers` → `admin/routes.ts:797`; `syncModifierProduct` `addonScheme.ts:255` | имя, цена, group_key | товар в категории «Добавки» + `modifiers.linked_product_id` + `parent_product_id` = папка | `modifiers.id`, `products.id` | adoption только в «Добавках» (`addonScheme.ts:273-291`) |
| 5 | Схемы добавок | `MenuGroups.tsx:115-235` → `POST /api/admin/modifier-schemes` (`options`) → `admin/routes.ts:898-990` | `options[]` (kind/groupKey/required/maxCount) | `modifier_scheme_options` | `modifier_scheme_options.id` (**= `Topping.id`**), `scheme_id` | канон — options; `items` конвертируются |
| 6 | Привязка схемы к товару/группе | `MenuProducts.tsx:156` (`modifierSchemeId`) → `POST /products` или `/product-groups` | schemeId | `products.modifier_scheme_id`, `product_groups.modifier_scheme_id` | `modifier_scheme_id` | приоритет: товар → группа (`COALESCE`) |
| 7 | Хранение | SQLite `backend/data/sixth-cup.db` (WAL) | — | таблицы `products`, `product_groups`, `categories`, `modifiers`, `modifier_schemes`, `modifier_scheme_options`, `modifier_scheme_items` (legacy), `product_store_links`, `product_store_availability`, `evotor_*` | внутренние id | — |
| 8 | API каталога | `backend/src/modules/devices/routes.ts:154-500` `GET /api/devices/catalog` | `storeUuid` | `products[]` + `groups[]` + `categories[]` | `id/productId`, `evotorUuid`, `groupId`, `parentProductId`, `toppings[].id` | `available=1` (`:300`), store availability (`:303-315`), сезон, `hideFromMenu` (`:444`) |
| 9 | Отправка в Эвотор | `ProductPushService` (`listLocal` `:214`, `toEvotorProduct` `:75-110`, `pushPending` `:368`) | строки `products` (`catalog_source='SIXTH_CUP'`) | Cloud product: name, price, `allow_to_sell`, `parent_id`, `article_number` | `evotor_uuid` из ответа → `product_store_links` | `available` + сезон; **per-store availability не учитывается** |
| 10 | Обратная синхронизация из Эвотора | `ProductPushService.remoteProducts` / `evotor_products` | ответ Cloud | локальные привязки | `evotor_uuid` | `catalog_source` |
| 11 | Каталог для конкретной точки | `devices/routes.ts:303-315`, `330-345` | `storeUuid` | uuid только этой точки | `product_store_links(store_uuid)` | нет fallback на чужой магазин при заданном `storeUuid` |
| 12 | Локальное хранение на кассе | `CatalogCache.kt:135-180` (save), `:20-120` (load) | `CatalogApi.Payload` | JSON в `filesDir/catalog_enrich_v2-<store>.json` | uuid/имя как ключи | сохраняет `hideFromMenu`, `groupId`, `variantLabel`, `sizeValue` |
| 13 | Плитки основного меню | `InventoryRepository.load` `:95-150` → `CatalogApi.merge` `:162-207` → `DrinkVariants.build` `:73-140` → `MainActivity.computeRows` `:919-955` | ProductTable + payload | `variantModel.tiles` | `uuid`; `variantGroup` = `admin-group:<groupId>` | `allow_to_sell` (`:119`), папки пропускаются (`:114`), `optGroup`, `hideFromMenu`, добавки по uuid/имени (`:84-113`) |
| 14 | Карточка товара | `MainActivity.showItemSheet` `:1019-1205` → `OptionPicker` | `variantsOf(tile)`, `Opts` | выбор объёма + добавок | `CatalogProduct.uuid` варианта; `Topping.id` | `blockers()` (required/maxCount) |
| 15 | Выбор объёма | `OptionPicker` (`variant`, `selectedVariant`), `DrinkVariants.variantsOf` | варианты группы | один `CatalogProduct` | uuid варианта | размеры сортируются по `sizeMl` |
| 16 | Выбор добавок | `OptionPicker` + `ToppingRules` | `milk/syrup/sugar/extra` | выбранные `Opt` | `t:<Topping.id>` | sellable/required/maxCount/zero |
| 17 | Корзина | `MainActivity.kt:1181-1196` | вариант + опции | `CartLine(variant.uuid, …)` + отдельные `CartLine(topping.evotorUuid, optionId=t.id)` | uuid варианта, uuid добавки, `optionId` | `zeroOption` и опции без uuid не добавляются |
| 18 | Передача в продажу | `SellLauncher.openSellReceipt` `:45-90`, `ReceiptValidator` | `Cart.all()` | `PositionAdd[]` + `OpenSellReceiptCommand` | `InventoryApi.getProductByUuid(line.productUuid)` | synthetic/blank uuid отбрасываются; цена — терминальная |

---

## C. Фактическая модель данных

### C.1 Таблицы и связи

| Таблица | Ключевые поля | Смысл |
|---|---|---|
| `products` | `id`, `name`, `price`, `available`, `category_id`, `group_id`, `variant_label`, `variant_sort`, `size_value`, `size_unit`, `is_group`, `parent_product_id`, `modifier_scheme_id`, `catalog_source`, `evotor_uuid` (legacy) | одновременно и торговая позиция, и «папка» (`is_group=1`), и SKU размера |
| `product_groups` | `id`, `name`, `modifier_scheme_id`, `counts_as_cup`, `free_eligible` | витринная карточка «Капучино» (1 строка на N SKU) |
| `categories` | `id`, `name`, `sort_order`, `available` | категории меню; «Добавки» определяется по имени |
| `modifiers` | `id`, `name`, `price`, `group_key`, `available`, `linked_product_id` | справочник добавок (legacy-вход) |
| `modifier_schemes` | `id`, `name` | схема |
| `modifier_scheme_options` | `id`, `scheme_id`, `kind` (`product`/`zero`/`modifier`), `product_id`, `modifier_id`, `name`, `group_key`, `is_default`, `required`, `max_count`, `price_override`, `sort_order` | **канон** схемы |
| `modifier_scheme_items` | `scheme_id`, `modifier_id`, `product_id`, `group_key`, `required`, `max_count`, `zero_option`, `name_override` | legacy; читается только если options нет, больше не пишется |
| `product_store_links` | `product_id`, `store_uuid`, `evotor_uuid` | uuid товара в конкретном магазине |
| `product_store_availability` | `product_id`, `store_uuid`, `available` | доступность товара в точке (только каталог) |
| `evotor_*` | `evotor_stores`, `evotor_products`, `evotor_outbox`, `evotor_sync_state`, `evotor_sync_log` | состояние синхронизации |

### C.2 Реальные записи (копия локальной БД; **не** данные кассы)

Основной товар / вариант:

| Поле | «Капучино-тест 200 мл» (id 19) | «Капучино-тест 200 мл» (id 23) |
|---|---|---|
| ID | 19 | 23 |
| Название | Капучино-тест 200 мл | Капучино-тест 200 мл |
| Группа (`group_id`) | **1** | **2** (другая!) |
| Связь с родителем (`parent_product_id`) | NULL | NULL |
| `variant_label` | 200 мл | 200 мл |
| UUID/OID | нет (`product_store_links` отсутствует) | нет |
| Цена | 200 | 200 |
| Признак отображения | `available=1`, `category_id=NULL`, `modifier_scheme_id=NULL` | то же |

Итого в БД **пять** таких строк (id 19, 23, 27, 32, 37), каждая в **отдельной** `product_groups` (1…5). Групп с более чем одним вариантом — ноль.

Добавки и папки:

| Поле | «Ваниль» (42) | «орех-ТЕСТ» (20) | «орех-ТЕСТ» (24) | «Сиропы» (48) |
|---|---|---|---|---|
| Категория | 4 «Добавки» | 4 «Добавки» | **NULL** | NULL |
| `is_group` | 0 | 0 | 0 | **1** (папка) |
| `parent_product_id` | 48 («Сиропы») | 48 | NULL | NULL |
| `linked_product_id` (modifiers) | 42 | 20 | **нет** | — |
| Каталог: `isModifier` / `hideFromMenu` | true / true | true / true | **false / false** | false / **true** |
| UUID | нет | нет | нет | нет |

Схемы: 7 схем; канон `options` заполнен только у схемы 7 (zero «Обычное» + `modifier` 13 «Лаванда»), у схем 1–6 только legacy `items`. У схемы 7 одновременно есть 2 `options` и 1 legacy `item` — след параллельной записи до исправления R1.

**Вывод по C:** локальная БД загрязнена тестовыми записями, созданными 2026-10-22 и 2026-10-24 (до коммита `c2396d4`, добавившего изоляцию тестовой БД). Эти записи **попадают в каталог** и часть из них **не помечена как добавки**.

---

## D. Таблица идентификаторов

| Идентификатор | Где хранится | Кто создаёт | Что идентифицирует | Где используется | Может ли меняться |
|---|---|---|---|---|---|
| `products.id` | SQLite | автоинкремент | локальный товар | админка, `product_store_links`, `buildCatalogToppings` | нет |
| `product_groups.id` | SQLite | админка | витринная карточка размеров | `products.group_id` → `groupId` в JSON | нет |
| `products.group_id` | SQLite | админка | принадлежность SKU к карточке | `CatalogApi.merge` → `variantGroup="admin-group:<id>"` | да (пересохранение карточки) |
| `products.parent_product_id` | SQLite | `syncModifierProduct` / админка | папка Эвотор (is_group) | `parentUuidFor` → `parent_id` в Cloud | да |
| `modifier_scheme_options.id` | SQLite | админка | **`Topping.id`**, ключ опции | `ToppingRules` (`t:<id>`), `ReceiptValidator.optionId` | нет (id стабильны при пересохранении) |
| `modifiers.id` | SQLite | админка | legacy-добавка | схема (`kind=modifier`) | нет |
| `products.evotor_uuid` | SQLite | legacy | — | почти не используется; `ProductPushService.ts:308` прямо называет колонку legacy | да |
| `product_store_links.evotor_uuid` | SQLite | ответ Evotor Cloud | **uuid товара в магазине** | каталог `evotorUuid`, `PositionAdd`, корзина | нет (перезапись при перепривязке) |
| `article_number` = `sc-<products.id>` / `sc-g-<id>` | Evotor Cloud | `toEvotorProduct` (`ProductPushService.ts:91,104`) | стабильная связка с локальным товаром | **Evotor `ProductTable.ROW_CODE`** (см. G) | нет |
| `Topping.groupKey` | options | админка | группа добавки | `OptionPicker`, `ToppingRules.groupLimit` | да |
| `sc` (в чеке) | extras | APK `CardSession` | лояльность в чеке | backend `loyaltyExtras.ts` | — |

**Вывод по D:** в системе есть стабильный сквозной идентификатор `article_number = sc-<id>`, который уже уезжает в Эвотор, но **касса его не читает** (в `InventoryRepository` нет чтения `ROW_CODE`, `CatalogProduct.article` всегда `null`). Сопоставление backend ↔ касса сейчас делается по `evotorUuid` и по имени — оба нестабильны (uuid зависит от точки, имя — от переименований и коллизий).

---

## E. Почему добавки попали в общее меню

### E1. Единственный механизм скрытия — флаг backend, привязанный к успешному сопоставлению `[Код]`

- Меню строится из **номенклатуры Эвотор** (`InventoryRepository.load`), а не из backend: `products = merged` `[MainActivity.kt:320-328]`.
- Плиткой не становится только то, что отфильтровал `DrinkVariants.build` `[DrinkVariants.kt:94-100]`: `optGroup != null`, combo, `hideFromMenu`, uuid/имя из `toppings`.
- `hideFromMenu` появляется у товара **только если** `CatalogApi.merge` нашёл для него `Enrich` `[CatalogApi.kt:201]`: по `evotorUuid` → по точному имени → по имени без объёма `[CatalogApi.kt:168-171]`.
- Если `Enrich` не найден, товар остаётся с `hideFromMenu=false`, `toppings=[]` и **рисуется плиткой**.

Отсюда все сценарии «добавка в меню»: любой промах сопоставления = видимая добавка. Запасного правила («категория Добавки на кассе», «нет в каталоге — скрыть») в клиенте нет.

### E2. Причины промаха сопоставления `[Код]`

| Причина | Механизм | Файл |
|---|---|---|
| Товара нет в ответе каталога | каталог фильтрует `available=1`, сезон и **per-store availability**; в Эвотор товар при этом может остаться sellable | `devices/routes.ts:300,303-315`; `ProductPushService.ts:101` (per-store не учитывается) |
| Неоднозначное имя | если два товара дают одинаковый нормализованный ключ, имя **удаляется** из `byName` → fallback не срабатывает | `CatalogApi.kt:276-290` |
| Другое имя в Эвоторе | переименование в кабинете/приложении ломает name-fallback | `Names.normalize` |
| Другой `storeUuid` | uuid-ключи только этой точки; при неверном `storeUuid` остаётся name-fallback | `devices/routes.ts:330-345`, `StoreUuidResolver.kt` |
| Старая версия APK | до `4.9.6-hide-modifiers` фильтра просто нет | `f40f4ac` |

### E3. Backend не считает добавкой товар вне «Добавок» `[Код]` `[Данные]`

- `listAddonProductIds` = товары **первой** категории, чьё имя содержит «добавк», + `product_id` из `options` + `linked_product_id` `[addonScheme.ts:312-342]`.
- `resolveAddonsCategoryId` возвращает **только первый** id `[addonScheme.ts:163-166]`, хотя рядом документировано, что категорий-добавок может быть несколько `[addonScheme.ts:147-152]`; PWA-роут использует полный список `[directory/routes.ts:35]`, а device-каталог — нет.
- Категория определяется **по имени**, а не по флагу/id. Переименование «Добавки» → «Топпинги» ломает скрытие для всех добавок, не привязанных через `linked_product_id`/`options.product_id`.
- Подтверждено данными: «орех-ТЕСТ» id 24/28/33/38 (категория NULL, без `linked_product_id`) в каталоге `isModifier=false, hide=false` `[API]`.

### E4. Дубли добавок, оставшиеся после старой логики `[Код]` `[Данные]`

`syncModifierProduct` после `c2396d4` **не переиспользует** товар вне «Добавок» и создаёт новый `[addonScheme.ts:271-307]`. Старые дубли (созданные прежним adoption-по-имени) остаются в прежних категориях без `linked_product_id` (в БД — модификаторы 8–11 без ссылки, товары 24/28/33/38). Они не скрываются.

### E5. Холодный старт без кэша `[Код]`

Если кэша нет, до ответа сервера показывается «сырая» номенклатура: `inv != null -> CatalogApi.applySoftFocus(inv)` `[MainActivity.kt:265-268]`. При недоступном backend и пустом кэше это состояние остаётся постоянным — добавки видны, объёмы раздельны. Диагностика в логах: `enrich merge matched NOTHING store=… — toppings will be empty` `[MainActivity.kt:337-340]`.

### Ответы на вопросы раздела 7 ТЗ

1. **Почему добавки в меню?** Потому что меню строится из Inventory, а скрытие — вычисляемый флаг backend, теряющийся при любом промахе сопоставления; плюс товары-добавки вне «Добавок»/без привязки backend добавками не считает.
2. **Где должны исключаться?** На backend — устойчивым признаком (id/флаг категории), на клиенте — запасное правило по этому признаку, а не только по совпадению имени/uuid.
3. **Где сейчас?** `DrinkVariants.build` `[DrinkVariants.kt:94-100]` + флаги `hideFromMenu`/`toppings` из `CatalogApi.merge` `[CatalogApi.kt:201]`.
4. **Фильтр работает на backend, но не на кассе?** Да, это и есть основной сценарий: флаг корректен, но не доехал до конкретного товара в Inventory.
5. **Передаётся ли категория в кассу?** Да: `categoryId`/`categoryName` в JSON `[devices/routes.ts:427]`, читается в `CatalogApi.kt:263`, но **не используется** для скрытия.
6. **Если категория не передаётся?** Клиент определяет тип по разметке `#opt=` в DESCRIPTION и по флагам backend; фолбэка по категории нет.
7. **Может ли добавка быть и в меню, и в схеме?** Да — именно это и наблюдается: одна и та же добавка как плитка (не скрыта) и как опция в карточке.
8. **Схема никому не назначена:** добавки всё равно скрываются, если они в «Добавках»/привязаны к `modifiers` (скрытие не зависит от схемы).
9. **Схема у нескольких напитков:** `modifier_scheme_id` у товара/группы один; одна схема может использоваться многими товарами — это поддержано.
10. **Схема отсутствует/пустая/повреждена/удалённая добавка:** каталог отдаёт пустые `toppings`; `ReceiptValidator` ловит `option_removed`; карточка откроется без опций `[ReceiptValidator.kt:40-56]`.
11. **Legacy `modifier_id` vs новый `product_id`:** оба поддержаны; при сохранении items конвертируются в options; каталог читает options, если они есть.
12. **Одна добавка в нескольких схемах без дублей:** да, через одну строку `modifiers`/`products` и несколько `options`.

---

## F. Почему объёмы отображаются отдельными плитками

### F1. В Эвотор нет понятия «размер/группа размеров» `[Код]`

`toEvotorProduct` отправляет каждый SKU как обычный товар: `name`, `price`, `allow_to_sell`, `description = recipe_text`, `article_number = sc-<id>`; `parent_id` ставится только для `parent_product_id` (папки добавок) `[ProductPushService.ts:75-110]`. `product_groups` в Эвотор **не выгружается вообще** (нет ни одной ссылки в `src/integrations`, `src/modules/sync`).

### F2. Группировка в APK — два источника, оба хрупкие `[Код]`

`DrinkVariants.build` `[DrinkVariants.kt:73-140]`:
- `variantGroup` из backend: `admin-group:<groupId>` `[CatalogApi.kt:204]` — работает только если `Enrich` найден;
- иначе `#group=` из DESCRIPTION `[InventoryRepository.kt:137]` — **backend такие метки не пишет** (grep `#group`/`#size` по backend — 0 совпадений);
- иначе авто-группа по имени `^(.*?)\s+(\d{2,4})\s*(мл|ml)\.?$` `[DrinkVariants.kt:64-70,157]`.

Следствия:
- имя «Капучино 200 мл» группируется даже без backend;
- имя «Капучино 0,2 л», «Капучино S», «Капучино 200» (метка размера без «мл») — **не группируется**: плитки раздельные;
- админка требует метку размера, но проверяет только непустоту и уникальность (`MenuProducts.tsx:143-145`), подсказка «например 200 мл» не обязательна; SKU получает имя `<группа> <label>` `[admin/routes.ts:688]`.

### F3. Данные: вариант в собственной группе = отдельная плитка `[Данные]` `[Код]`

В локальной БД 5 товаров «Капучино-тест 200 мл» лежат в 5 разных `product_groups`. Клиент превращает каждый `groupId` в свой `admin-group:N` → 5 ключей → 5 плиток `[DrinkVariants.kt:102-135]`. Это ровно симптом B, воспроизводимый на текущем коде без единой ошибки backend.

### F4. `groups[]` из контракта игнорируется `[Код]`

`GET /api/devices/catalog` отдаёт `groups[]` с вариантами `[devices/routes.ts:455-483]`, это описано в `docs/DEVICE-CATALOG-API.md` (раздел «Размеры (объёмы) — groups[]»), но в APK **нет чтения `groups`** (grep `"groups"` по `app/src/main/java` — 0 совпадений). Значит, если по товару не пришёл `groupId`, контракт `groups[]` уже не спасёт.

### F5. Частичная доступность группы

Каталог отдаёт только доступные SKU. Если вариант снят с продажи по точке/сезону, в группе остаётся меньше вариантов; при 1 оставшемся плитка всё равно одна, но при полном отсутствии — товар исчезает. Это ожидаемо, но вместе с D2 (per-store не уходит в Эвотор) даёт рассинхрон «на кассе есть, в каталоге нет».

---

## G. Анализ Эвотора

| Аспект | Факт | Источник |
|---|---|---|
| Что отправляется | обычный Cloud product: `name`, `type=NORMAL`, `measure_name`, `tax`, `allow_to_sell`, `price`, `cost_price`, `description=recipe_text`, `article_number=sc-<id>`, `parent_id` | `ProductPushService.ts:75-110` |
| Папки | `is_group=1` → `allow_to_sell=false`, `price=0`, `article_number=sc-g-<id>`; дети получают `parent_id` = uuid папки | `:78-95`, `parentUuidFor:112-119` |
| Группы размеров | в Эвотор не передаются; каждый объём — самостоятельный товар | grep по `product_groups` в `integrations/sync` — 0 |
| Скрытие с витрины | в API Эвотора признака «скрыть из верхнего меню» проект не использует; витрину рисует APK | `docs/EVOTOR-CATALOG-ALIGN.md:11-33` |
| Идентификаторы для продажи | `evotor_uuid` из `product_store_links`; `Position.Builder.newInstance(item, qty)` по uuid | `SellLauncher.kt:66-82` |
| `ROW_CODE` в ProductTable | колонка существует (`ROW_CODE`), но APK её не читает; `article_number=sc-<id>` уже приходит в Эвотор | `javap ProductTable v0.6.27`, `InventoryRepository.kt:99-106` |
| Официальная документация | в репо есть `docs/EVOTOR-FACTS.md` (факты прод-диагностики) и `EVOTOR-CATALOG-ALIGN.md`; полной официальной спецификации групп/вариантов нет | — |

**Ключевой вывод:** существование товара в каталоге Эвотора ≠ отображение в меню APK. Добавки и SKU обязаны существовать в Эвотор для фискализации; скрывать их должно приложение. Сейчас это делается единственным вычисляемым флагом — отсюда хрупкость.

---

## H. Корзина и продажа

| Сценарий | Поведение | Файл |
|---|---|---|
| Капучино без добавок | `CartLine(variant.uuid, variant.name, variant.priceRub)` — uuid выбранного размера | `MainActivity.kt:1181-1188` |
| Платная добавка | отдельная `CartLine(topping.evotorUuid, "label (вариант)", price, optionId=Topping.id)` | `:1191-1195` |
| Бесплатная/zero опция | отдельной строкой не добавляется (`zeroOption` не имеет uuid, `chosen()` их не возвращает) | `MainActivity.kt:1192`, `ToppingRules` |
| Несколько добавок/повтор | лимит группы (`groupLimit`), повторный тап по выбранной опции не добавляет вторую | `ToppingRules.canSelect` |
| Платная без uuid | в корзину не попадает; `ReceiptValidator` → `option_without_uuid` | `MainActivity.kt:1192`, `ReceiptValidator.kt:50-52` |
| Чек | `PositionAdd` по uuid; цена — терминальная, расхождение только логируется | `SellLauncher.kt:66-82` |
| Повторное открытие карточки | корзина не дублируется: строки аддитивны, `signature`/`cartKey` группируют одинаковые конфигурации | `MainActivity.kt:1187` |
| Сеть недоступна | показывается кэш/сырая номенклатура с плашкой; чек не блокируется, но состав опций может отсутствовать | `MainActivity.kt:262-311` |

Ошибок «вариант подменяется uuid плитки» не найдено: `OptionPicker.selectedVariant` — это выбранный `CatalogProduct` из `variantsOf`, и именно его `uuid` уходит в корзину.

---

## I. Регрессии и следствия `c2396d4`

1. **Adoption только из «Добавок»** (`addonScheme.ts:271-297`): перестал «утаскивать» розничные товары — правильно, но **старые дубли не удалены**. Итог: в БД одновременно «правильная» добавка (в «Добавках», с `linked_product_id`) и её двойники вне категории, которые видны в меню.
2. **`028_unique_modifier_link.sql`**: уникальный индекс `uq_mod_linked_product` + обнуление дублей. Модель «одна добавка ↔ один товар» закреплена; две добавки с одним товаром теперь невозможны.
3. **Папки добавок** (`ensureAddonGroupProduct`, `addonScheme.ts:223-248`): добавки получили `parent_product_id` → в Эвотор уезжают в папки «Молоко/Сиропы/…». На витрину APK это не влияет (папки не плитки), но **создаёт иллюзию скрытия** в кабинете Эвотора: в нативном меню кассы они лежат в папке, а в APK видны, если флаг не доехал.
4. **Изоляция тестов** (`vitest.config.ts` + `setup-isolated-db.ts`): новые прогоны больше не пишут в рабочую БД, но накопленные строки остались и **могут быть выгружены в Эвотор** (`listLocal(false)` берёт всё с `catalog_source='SIXTH_CUP'`, а тестовые записи помечены именно так).
5. **Побочный эффект тестовой изоляции:** `device-catalog.test.ts` и др. больше не создают дублей в рабочей БД — это хорошо; но регрессионный тест на «добавка вне Добавок видна» отсутствует, поэтому утечка не была замечена.

---

## J. Матрица тестирования

| # | Сценарий | Текущее поведение | Ожидается | Автотест | Функция | Дефект | Нужны данные |
|---|---|---|---|---|---|---|---|
| 1 | 1 товар + 1 вариант | плитка одна | одна | частично (`product-variants`) | `DrinkVariants.build` | нет | — |
| 2 | 1 товар + N вариантов | одна плитка при `groupId`/«N мл» | одна | да (`product-variants`, `DrinkVariantsTest`) | то же | F2/F4 | — |
| 3 | Одинаковые имена в разных категориях | name-fallback отключается (ambiguous) | не склеивать | да (`CatalogApiMergeTest`) | `CatalogApi.parse:276-290` | нет | — |
| 4 | Добавка и товар с одним именем | backend не ворует товар | не воровать | да (`addon-single-entry`) | `syncModifierProduct` | нет | — |
| 5 | Добавка с корректной категорией | скрыта | скрыта | да (`device-catalog`, `addon-single-entry`) | `listAddonProductIds` | нет | — |
| 6 | Добавка без/с чужой категорией | **видна** | скрыта | **нет** | `listAddonProductIds` | E3 | список товаров |
| 7 | Вариант без связи с родителем | отдельная плитка | внутри карточки | нет | `DrinkVariants.build` | F1/F3 | — |
| 8 | Родитель без варианта | SKU остаются, группа удаляется | не падать | да (`product-variants`) | `admin/product-groups` | нет | — |
| 9 | Дублирующийся UUID | не проверяется | неопределённость | **нет** | `product_store_links` unique | — | — |
| 10 | Пустой/битый UUID | fallback по имени | не продавать без uuid | частично (`CatalogApiMergeTest`) | `CatalogApi.merge` | — | — |
| 11 | Удалённая добавка в схеме | `option_removed` | блок | да (`addons-catalog-regressions`) | `ReceiptValidator` | нет | — |
| 12 | Удалённый родительский товар | не покрыто | корзина не теряет uuid | **нет** | — | — | — |
| 13 | Переименование товара | ломает name-fallback | устойчиво | частично (`NamesTest` внутри merge) | `Names` | E2 | — |
| 14 | Изменение объёма/цены | обновляет SKU | обновляет | да (`product-variants`) | admin/product-groups | нет | — |
| 15 | Повторная синхронизация товара | upsert по article/hash | без дублей | частично (`evotor-product-sync`) | `ProductPushService` | — | — |
| 16 | Повторная синхронизация добавки | цена уходит в товар | без дублей | да (`addon-single-entry`) | `syncModifierProduct` | нет | — |
| 17 | Сбой синхронизации посередине | outbox с retry | не терять | частично | `evotor_outbox` | — | — |
| 18 | Обновление каталога на кассе | merge каждые 60 c | обновляет | **нет** | `MainActivity.loadProducts` | — | — |
| 19 | Перезапуск кассы | кэш → merge | флаги сохранены | **нет** | `CatalogCache` | — | — |
| 20 | Работа с локальным кэшем | кэш хранит все поля | корректно | **нет** | `CatalogCache` | — | — |
| 21 | Несколько точек | uuid только своей точки | изоляция | да (`device-catalog`, `addon-single-entry`) | `devices/routes.ts:330-345` | нет | — |
| 22 | Legacy `modifier_id` | конвертация/чтение | работает | да (`addons-e2e`, `addons-catalog-regressions`) | `itemsPayloadToOptions` | нет | — |
| 23 | Новая схема `product_id` | работает | работает | да | `replaceSchemeOptions` | нет | — |
| 24 | Платная добавка с uuid | отдельная позиция | в чек | да (`AddonsCatalogFixtureTest`) | `ReceiptValidator`/`SellLauncher` | нет | — |
| 25 | Бесплатная опция | без строки в чеке | без строки | да (`ToppingRulesTest`, fixture) | `ToppingRules` | нет | — |
| 26 | Товар продаётся сам и в схеме | может быть и плиткой, и опцией | осознанно | **нет** | — | — | — |
| 27 | Несколько схем у товара | модель не допускает (1 `modifier_scheme_id`) | — | — | схема БД | нет | — |

Пробелы в тестах: скрытие добавки вне «Добавок», клиентский фильтр плиток по `hideFromMenu`, кэш кассы, `groups[]`, per-store availability ↔ Эвотор, удалённый родитель.

---

## K. Перечень дефектов

### D1. Добавка может отображаться плиткой (причина симптома A) — **высокий**
- Симптом: сиропы/добавки в общем меню.
- Доказательство: `[Код]` `DrinkVariants.kt:94-100`, `CatalogApi.kt:168-171,201`; `[Данные]`/`[API]` товары «орех-ТЕСТ» 24/28/33/38 → `hide=false`.
- Первопричина: скрытие не имеет устойчивого клиентского признака; зависит от сопоставления по uuid/имени.
- Последствия: гость/кассир может продать добавку как отдельный товар; схема добавок дублируется.
- Воспроизведение: товар вне категории «Добавки» без `linked_product_id` (или переименовать «Добавки») → перезапустить кассу → плитка.
- Возможное исправление: устойчивый признак (см. M), клиентский фолбэк по категории/`article`, отказ от name-only идентификации.
- Тесты: каталог «добавка вне Добавок»; APK-фильтр плиток по `hideFromMenu`; merge по `article`.

### D2. Категория добавок определяется по имени и только первая — **средний/высокий**
- `addonScheme.ts:155-166,312-342`; PWA использует все категории (`directory/routes.ts:35`).
- Последствия: переименование/дубль категории → добавки в меню.
- Воспроизведение: создать вторую категорию с «добавк» в имени и товар в ней.
- Исправление: флаг категории (колонка `is_addons`) или использование **всех** id + явный признак у товара.
- Тесты: unit на `listAddonProductIds` с двумя категориями.

### D3. Объёмы отдельными плитками — **высокий**
- `[Код]` `DrinkVariants.kt:64-70,157`, `CatalogApi.kt:204`; `[Данные]` 5 групп по 1 SKU.
- Причины: (а) клиент не читает `groups[]`; (б) группировка по имени требует «N мл»; (в) варианты в разных `product_groups`; (г) промах enrichment.
- Исправление: группировать по `groupId` **и** по `groups[]`; валидировать в админке метку/`sizeValue`; предупреждать о «группе из одного варианта»; добавить фолбэк по `article`.
- Тесты: фикстура с `groups[]` на клиенте; кейс «label без мл».

### D4. `PUT /products/:id/stores` не существует — **средний**
- `frontend-admin/src/pages/MenuProducts.tsx:186` вызывает несуществующий маршрут → 404, в UI «Не удалось сохранить» после успешного сохранения; per-store доступность из карточки не сохраняется.
- Исправление: реализовать маршрут (или убрать вызов), вызывать `enqueueProductSync` при изменении доступности.

### D5. Per-store availability не влияет на продажу в Эвотор — **средний**
- `devices/routes.ts:303-315` фильтрует каталог; `ProductPushService.ts:101` учитывает только `p.available`.
- Последствия: товар «выключен для точки», но продаётся на кассе; из каталога он выпадает → флаги скрытия добавляк теряются (см. E2).
- Исправление: при `PUT availability` пересчитывать `allow_to_sell` (или скрывать из APK по store-флагу), синхронизировать изменения.

### D6. Витрина зависит от сети/кэша без явного состояния «каталог не получен» — **средний**
- `MainActivity.kt:265-268`: при отсутствии кэша показывается ненормализованная номенклатура (добавки/объёмы как есть); нет блокировки или явной плашки «меню не готово».
- Исправление: не показывать сырой список как меню; либо скрывать по локальному признаку, либо явный экран «каталог недоступен».

### D7. `article_number` не используется кассой — **низкий/средний** (упущенная возможность)
- `ProductPushService.ts:91,104` уже пишет `sc-<id>`; `ProductTable.ROW_CODE` доступен; `InventoryRepository` его не читает, `CatalogProduct.article = null` (`:122`).
- Исправление: читать `ROW_CODE`, парсить `sc-<id>`, сопоставлять по id — устойчиво к переименованиям и неоднозначным именам.

### D8. Тестовые записи в рабочей БД — **высокий (эксплуатационный)**
- `[Данные]`: 5×«Капучино-тест 200 мл» в 5 группах, 4×«орех-ТЕСТ» вне «Добавок», «Булочка-тест», «Мульти-тест», «Раф-1792841909731», 4 схемы «Кофе-тест», 15 модификаторов (часть тестовые). Созданы 2026-10-22/24 до `c2396d4`.
- Риск: `listLocal(false)` берёт всё `SIXTH_CUP` → при включённом sync они уедут в Эвотор и появятся на кассе.
- Исправление: **только с разрешения владельца** — инвентаризация и мягкое снятие (`available=0`) с проверкой, что на них нет ссылок в чеках/схемах. Автоматически не делать.

---

## L. Неопределённости

1. **Версия APK на тестовой кассе** — неизвестна. Без неё нельзя отличить «старая сборка» (до 4.9.6) от «текущей». Как получить: `adb logcat | grep app_start` — строка `app_start v<versionName> (<versionCode>) store=…` `[MainActivity.kt:219]`.
2. **Реальный ответ каталога для точки кассы** — нужен `GET /api/devices/catalog?storeUuid=<uuid>` с её backend. Пока его нет, нельзя сказать, какие именно товары приходят без `hideFromMenu`.
3. **Логи кассы** — нужна строка `catalog ok byUuid=… byName=…`, `enrich ok products=… matchedUuid=… matchedName=…` и особенно `enrich merge matched NOTHING` `[MainActivity.kt:335-340]`, `[CatalogApi.kt:148-151]`.
4. **Какая категория называется «Добавки» на рабочей БД** и нет ли второй похожей — влияет на D2.
5. **Есть ли у товаров `article_number` в ProductTable на устройстве** — проверяется чтением `ROW_CODE` у одного выгруженного товара.
6. **Официальная семантика `article_number` ↔ `ROW_CODE`** в Evotor Cloud/POS — в репозитории не зафиксирована; нужен ответ документации/подтверждение на устройстве.
7. **Данные тестовой кассы** (products/groups/schemes) — в этом окружении недоступны.

---

## M. Рекомендуемая целевая логика (не реализовано)

1. **Один основной товар в меню.** Витрина строится по `product_groups` (карточка) + одиночные товары. Признак «это карточка, а не SKU» приходит с backend (`groupId`) и подтверждается `groups[]`.
2. **Варианты только внутри карточки.** Клиент обязан:
   - группировать по `groupId`, **и** уметь собрать группу из `groups[]`, если `groupId` не доехал;
   - не полагаться на имя как на единственный признак размера;
   - при «группе из одного варианта» показывать одну плитку (не плодить дубли), но сигнализировать в логах.
3. **Добавки только внутри карточки.** Скрытие — по устойчивому признаку:
   - на backend: явный флаг/категория по id (не по имени), учитывать **все** категории-добавки;
   - на клиенте: запасное правило «`hideFromMenu`/категория Добавки/`article=sc-<id>` из списка добавок → не плитка»;
   - сопоставление backend ↔ касса в первую очередь по `article_number`/`ROW_CODE`, затем uuid, имя — только как последний фолбэк.
4. **Идентификаторы и цены.** В чек уходит uuid выбранного варианта и uuid платной добавки; zero-опции строк не создают; цена — терминальная.
5. **Legacy.** `modifier_scheme_items` остаётся только read-only fallback; конверсия при сохранении; новые записи — только `options`.
6. **Повторная синхронизация/перезапуск.** Ничего не зависит от порядка: id опций стабильны, кэш хранит все поля, повторный upsert идемпотентен.
7. **Разделение «есть в Эвотор» и «видно в меню».** Наличие товара в Эвотор — требование фискализации; видимость — решение APK на основе устойчивого признака, а не совпадения имён.
8. **Согласованность доступности.** `product_store_availability` должна либо влиять и на Эвотор, и на каталог, либо не использоваться вовсе; сейчас это третий, «полувключённый» источник истины.

---

## N. План дальнейших действий (не выполнять без согласования)

| Этап | Что | Файлы | Риски | Критерий приёмки |
|---|---|---|---|---|
| **N1** | Диагностика на кассе: версия, logcat по каталогу, ответ `catalog` для её store | без правок | нет | известны versionName и `matchedUuid/matchedName` |
| **N2** | Инвентаризация тестовых строк в рабочей БД, мягкое снятие с продажи **с разрешения** | SQL/админка | снятие реального товара | список согласован, ни одна схема/чек не сломаны |
| **N3** | Устойчивый признак добавки на backend: все категории-добавки + явный флаг/id; аддитивно к API | `addonScheme.ts`, `devices/routes.ts`, миграция | старые APK должны продолжать работать | новый тест «добавка вне Добавок скрыта» |
| **N4** | Клиентский фолбэк: скрывать по категории/флагу, группировать по `groups[]`, сопоставление по `article` | `CatalogApi.kt`, `InventoryRepository.kt`, `DrinkVariants.kt` | риск скрыть нужный товар при неверной категории | APK-тесты на фикстуре + кейс «label без мл» |
| **N5** | Починить per-store availability: маршрут `/products/:id/stores`, пересчёт `allow_to_sell`, sync | `admin/routes.ts`, `ProductPushService.ts` | выключение товара не там | тест «точка A выключена — нет в каталоге и не продаётся» |
| **N6** | Кэш/офлайн: не показывать сырое меню как финальное; явное состояние | `MainActivity.kt` | UX | тест `CatalogCache` round-trip + сценарий «нет сети» |

---

## Резюме для владельца кофейни

- **Что сломано.** На кассе добавки (сиропы и пр.) показываются отдельными плитками в общем меню, а объёмы одного напитка — отдельными товарами вместо выбора внутри карточки. Продажа при этом формируется правильно: в чек уходит выбранный объём и платные добавки отдельными позициями.
- **Почему.** Касса берёт список товаров из Эвотор, а «что скрыть» узнаёт у сервера и сопоставляет товары **по UUID или по названию**. Если название в Эвотор отличается, товара нет в ответе сервера или на кассе старый APK — добавка остаётся в меню. Объёмы в Эвотор не имеют признака «одна карточка»: сервер передаёт группу, но касса опирается на неё только при удачном сопоставлении, а иначе группирует по названию «… 200 мл». Плюс в рабочей базе остались тестовые товары («Капучино-тест», «орех-ТЕСТ»), часть из них сервер не считает добавками.
- **Что исправлять в первую очередь.** 1) Диагностика на кассе (версия + логи каталога) — 15 минут, сразу покажет, старый ли APK и доехали ли флаги. 2) Убрать тестовые товары из рабочей базы (только с вашего согласия). 3) Сделать устойчивый признак добавки и группировку объёмов, не зависящую от названий.
- **Риски вариантов.** Быстрый костыль «скрывать всё, где в названии категории „Добавки“» может спрятать реальный товар, если категория названа иначе. Переход на артикул `sc-<id>` надёжен, но требует проверки на одном товаре на устройстве. Массовая чистка базы рискованна: можно снять с продажи нужный товар — поэтому только после сверки и с вашим подтверждением.
