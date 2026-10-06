# 6.7 Coffee — backend + PWA + Evotor admin

Веб-проект лояльности и бизнес-админки для 6.7 Coffee. Android-приложение Эвотора — отдельный репозиторий `6.7-evotor-app-main`.

## Роли

| Компонент | Источник истины |
|---|---|
| Evotor Cloud | торговые точки, сотрудники, базовая номенклатура и Evotor UUID |
| 6.7 backend | рецепты, топпинги, loyalty, сезонность, себестоимость, custom metadata |
| 6.7 admin | единый интерфейс для данных Evotor + данных 6.7 |
| 6.7 APK | интерфейс товара на терминале поверх локального inventory Эвотора |

## Каталог

Новый товар создаётся в админке 6.7. Backend отправляет его в Evotor Cloud без product UUID. Cloud выдаёт UUID, backend сохраняет его в `product_store_links` / `evotor_products`, а последующие изменения идут PUT по этому UUID.

Для защиты от дублей при потерянном ответе CREATE используется стабильный `article_number=sc-<localProductId>`. Входящие товары Эвотора upsert-ятся по `(store_uuid, evotor_uuid)`.

Рецепт и топпинги передаются на терминал через `ProductExtra` с именем `sixthcup`.

Полная схема: **[docs/PRODUCT-SYNC-EVOTOR.md](./docs/PRODUCT-SYNC-EVOTOR.md)**.

## Loyalty

- signed QR — основной способ идентификации;
- numeric short card code — ручной fallback;
- `extras.sc` попадает в фискальный SELL;
- Poll + SellHandler остаются единственным источником истины для начислений.

## Dev

```bash
npm install
npm run dev
# client :5173 · admin :5174 · API :3000
```

Перед production обязательно пройти физическую проверку на тестовом ST5: Cloud CREATE/PUT, доставка номенклатуры на терминал, ProductExtra, добавление Position в чек и полный SELL → poll → loyalty цикл.
