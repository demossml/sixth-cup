# Рекомендации на кассе (upsell) — отчёт о реализации

## HEAD на старте

`5113d01` (fix(poster): shrink sheet when a dish name clashes with prices), ветка `main`.

## Что сделано

Серия `prompts-upsell-admin` выполнена целиком, STEP 0→8. APK-репозиторий не менялся.

### STEP-1. Хранение настроек

- Модуль [backend/src/lib/cashierUpsell.ts](../backend/src/lib/cashierUpsell.ts) — по образцу `cashierMenu`.
- Ключи `app_settings`: `cashier_upsell:<storeUuid>` (точка) и `cashier_upsell` (общая настройка-наследство).
- **Default `enabled: false`**, списки пустые.
- Битый JSON → заводская настройка, не 500.
- Миграция не понадобилась: таблица `app_settings` уже есть.

### STEP-2. Admin API

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/admin/cashier/upsell?storeUuid=` | настройка + `own` + разрешённые имена/цены + справочник товаров |
| PUT | `/api/admin/cashier/upsell` | `{ storeUuid?, enabled, defaultProductIds?, byProductId? }` |
| DELETE | `/api/admin/cashier/upsell?storeUuid=` | сброс точки на общую настройку |

Валидация: неизвестный/недоступный товар → 400; товары-добавки мягко отфильтровываются
(`skipped` в ответе); потолки `defaults ≤ 12`, `perProduct ≤ 6`; сам товар из своих рекомендаций исключается.

### STEP-3. Каталог уважает флаг

`GET /api/devices/catalog`:

- `enabled: false` → у каждого `products[i].upsell = []`, в корне
  `upsell: { enabled: false, defaults: [] }`, `upsellEnabled: false`, `upsellDefault: []`.
- `enabled: true` → корень с `defaults` по порядку админки; `products[i].upsell` = «к товару» + общий список,
  уникальные, без самого товара, до 6 (склейка нужна старым APK, которые читают только `products[].upsell`).
- Автопул «все товары, не считающиеся чашкой», удалён — он не отключался и подсовывал что угодно.
- Добавки (категория «Добавки», модификаторы) в рекомендации не попадают.
- `#upsell` в `description` в коде не читался и не читается; зафиксировано в docs.

### STEP-4. Админка

- Новый компонент [frontend-admin/src/pages/cash/CashierUpsellPanel.tsx](../frontend-admin/src/pages/cash/CashierUpsellPanel.tsx):
  сворачиваемая секция «Рекомендации на кассе» в карточке точки на странице **Касса**
  (там же, где «Меню на кассе»), плюс общий блок «Рекомендации на кассе — общие» над списком точек.
- Крупный тумблер «Показывать рекомендации на кассе» с подписью
  «Блок „Добавить к заказу“ и подсказки перед оплатой. Не влияет на молоко, сиропы и добавки к напитку.»
- Состояние OFF: блок приглушён (`opacity-50`), данные не стираются.
- «К любому заказу»: поиск по товарам, добавление, порядок стрелками, удаление, счётчик «N из 12».
- Кнопки «Сохранить» и «Сбросить к общей настройке» / «Выключить и очистить».
- После сохранения — баннер: обновить каталог на кассе (до ~60 с), добавки к напиткам не изменились.
- Ссылка на справку внутри панели.

### STEP-5. Документация

- [docs/DEVICE-CATALOG-API.md](../docs/DEVICE-CATALOG-API.md): новые корневые поля, таблица «выключено/включено»,
  правила defaults vs per-product, `#upsell` не источник, добавки — отдельный механизм.
- [docs/CASHIER-UPSELL.md](../docs/CASHIER-UPSELL.md): новый короткий документ (где, на точку, рубильник,
  что не трогает, как доезжает, APK, API, хранение).
- Справка в админке: статья `cashier-upsell` в [frontend-admin/src/pages/Help.tsx](../frontend-admin/src/pages/Help.tsx).
- [DEPLOYMENT.md](../DEPLOYMENT.md): раздел «Рекомендации на кассе (upsell)» — одна короткая выжимка.

### STEP-6. Legacy `#upsell`

В коде тег нигде не читался — импорт не нужен. В docs явно: тег игнорируется, источник правды — настройка точки.

### STEP-7. GUARD + smoke

Полный backend suite и typecheck — зелёные (см. ниже). Реальный HTTP-smoke на временной БД:
```
GET  /api/devices/catalog?storeUuid=smoke-store      → upsellEnabled=false, upsell.defaults=[], у товаров []
PUT  /api/admin/cashier/upsell {enabled:true,defaultProductIds:[1]}
GET  /api/devices/catalog?storeUuid=smoke-store      → upsellEnabled=true, defaults=["Круассан смоук"]
GET  /api/admin/cashier/upsell?storeUuid=smoke-store  → own=true, enabled=true, defaults=["Круассан смоук"]
DELETE /api/admin/cashier/upsell?storeUuid=…          → enabled=false, defaults=[]
PUT  с несуществующим id                              → 400
```

Дополнительно панель проверена в браузере на локальном стенде (backend на временной БД + admin dev):
тумблер включается, поиск находит товар, товар добавляется в список и сохраняется, бейдж меняется на
«включены», появляется баннер про обновление каталога; после сохранения
`GET /api/devices/catalog` отдаёт `upsellEnabled: true`, `upsell.defaults = [«Круассан»]`, а у самого
Круассана `upsell: []` (сам себя не рекомендует).

### Пример ответа каталога

Выключено (по умолчанию):

```json
{
  "upsellEnabled": false,
  "upsell": { "enabled": false, "defaults": [] },
  "upsellDefault": [],
  "products": [{ "id": 5, "name": "Капучино", "upsell": [] }]
}
```

Включено + один товар в «к любому заказу»:

```json
{
  "upsellEnabled": true,
  "upsell": { "enabled": true, "defaults": [{ "id": 8, "name": "Круассан", "price": 120, "imageUrl": null, "evotorUuid": "…" }] },
  "products": [{ "id": 5, "name": "Капучино", "upsell": [{ "id": 8, "name": "Круассан", "price": 120 }] }]
}
```

## Тесты

- backend: **1205 passed** (157 файлов), включая новый `src/__tests__/cashier-upsell.test.ts` (10 тестов).
- frontend-admin: **350 passed** (39 файлов), включая `CashierUpsellPanel.test.ts` (6 тестов).
- `npm run typecheck` — 5/5 задач успешно (backend, frontend, frontend-admin, packages).
- Обновлён эталон ответа APK `backend/src/__tests__/fixtures/addons-catalog-fixture.json`:
  `upsell` теперь пустой, добавлены корневые `upsellEnabled/upsell/upsellDefault`.
- `backend/src/__tests__/device-catalog.test.ts`: проверка «upsell исключает модификаторы» теперь
  настраивает рекомендации явно (по умолчанию их нет).

## Заметка для кассы (APK)

После сохранения настроек на терминале обновить каталог (потянуть список или подождать до ~60 с).
APK 5.3.20+ читает `upsell.enabled`/`upsellEnabled`; более старые версии получают пустые массивы и молчат.

## WHAT I DID NOT TOUCH

- toppings / молоко / схемы добавок / `configuration` endpoint — не менялись;
- «Фокус» (`featured`, `#focus`/`#combo`) — не менялся;
- меню кассы (порядок вкладок) — не менялось;
- APK-репозиторий и клиентское приложение — не трогались;
- прод не деплоился: ждём команды владельца.
