# Товары: админка 6.7 → API Эвотор → касса

## Цепочка

```
Админ создаёт товар в 6.7 (products)
        ↓
POST /api/admin/evotor/stores/{storeUuid}/push-products
        ↓
POST https://api.evotor.ru/api/v1/inventories/stores/{uuid}/products
  (X-Authorization: EVOTOR_API_TOKEN)
        ↓
Облако Эвотор
        ↓
Смарт-терминал: «Обновить» / автосинхронизация номенклатуры
        ↓
Товар виден при продаже на кассе
```

Магазины **не заводим руками** — `GET /api/admin/evotor/stores` ← `stores/search`.

## API админки (заголовок X-Admin-Token)

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/api/admin/evotor/stores` | Список магазинов из Облака |
| POST | `/api/admin/evotor/stores/:uuid/push-products` | Залить все available products |
| GET | `/api/admin/evotor/stores/:uuid/products` | Проверить, что в Облаке |
| POST | `/api/admin/evotor/poll` | Разовый опрос документов |
| GET/POST | `/api/admin/products` | Локальный каталог (как раньше) |

## PWA

`/api/directory` отдаёт те же `products` — меню гостя = то, что в нашей БД.  
После push на кассе ассортимент Эвотор совпадает, если синхронизация терминала прошла.

## На кассе после push

1. Магазин без HTTP 402 (приложение установлено/оплачено).
2. На терминале обновить товары из облака (или дождаться фоновой синхронизации).
3. Продажа штатным UI Эвотор — **не** требует enroll 6.7.

## Ограничения Phase сейчас

- Картинки товаров на кассе — отдельный контур (Эвотор media); в v1 POST — поля name/price/tax.
- Модификаторы/сиропы — следующий этап.
- APK 6.7 может показывать старый Catalog — для продажи используйте **стандартное меню Эвотор** после push.
