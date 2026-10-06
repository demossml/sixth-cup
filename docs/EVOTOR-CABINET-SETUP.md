# Настройка Evotor Cloud для 6.7 Coffee — фактическая Phase 0/1 схема

## 1. Что реально используется

Текущий рабочий контур основан на **Evotor Cloud API v1**:

- `X-Authorization: <EVOTOR_API_TOKEN>`;
- `/api/v1/inventories/...`;
- даты `gtCloseDate` / `ltCloseDate` в формате `YYYY-MM-DD`;
- `ltCloseDate` — исключительная граница;
- документы из реального тестового аккаунта содержат `transactions[]`.

Не использовать в коде старую схему с `body.positions`, миллисекундами `since/until` и курсором как основной контракт для этого проекта.

Официальная документация Evotor может показывать более новый V2-контур; **для этого проекта источником истины Phase 0 являются реальные ответы тестового аккаунта**, зафиксированные в `docs/EVOTOR-FACTS.md`.

## 2. Токен

На backend:

```bash
EVOTOR_API_TOKEN=...
```

Токен не хранить в исходниках, README, Git или frontend.

Проверка:

```bash
cd backend
npm run evotor:probe
```

## 3. APK

Собрать:

```bash
cd evotor-app-main
./gradlew :app:assembleDebug
```

Для проверки подписи QR передать публичный ключ backend и его `kid`:

```bash
./gradlew :app:assembleDebug \
  -PSERVER_PUBLIC_KEY='<base64url public key>' \
  -PSERVER_KEY_ID='<kid>'
```

Публичный ключ не является секретом, но реальное значение всё равно не коммитить без необходимости.

## 4. Phase 0.6

Обязательно:

1. Установить APK через кабинет Evotor.
2. Отсканировать подписанный QR клиента.
3. Открыть меню 6.7 Coffee и выбрать товар.
4. При необходимости применить loyalty на чеке.
5. Закрыть тестовую продажу.
6. Получить документ через Cloud API.
7. Проверить `extras.sc`.

До этого момента нельзя считать связь loyalty → чек доказанной.

## 5. Что должно попасть в extras

Пример:

```json
{
  "sc": {
    "v": 2,
    "kid": "k-...",
    "c": "<signed-card-token>",
    "q": 12,
    "op": "<uuid>",
    "free": 1,
    "cb": 8000,
    "disc": "18.00",
    "ts": 1790000000
  }
}
```

`c` — signed QR token или numeric short card code. Signed token backend повторно проверяет по подписи/сроку; numeric code нормализуется и ищется по `card_code`. Нельзя доверять числовым значениям `free`, `cb` или `disc` без проверки состояния карты.

## 6. Что не используется как обязательная часть текущего контура

- `/api/v1/user/create`;
- `/api/v1/user/verify`;
- `/api/v1/user/token`;
- SMS;
- прямой HTTPS с APK на backend;
- отдельный device-enroll для текущего APK;
- хардкодный каталог в APK.

Ручной numeric card code, наоборот, **используется** как fallback к signed QR.

## 7. Номенклатура

Evotor Cloud является источником истины для базовой номенклатуры и UUID товара. 6.7 хранит собственный `products.id` и таблицу связи `product_store_links`.

Новый товар создаётся POST без Evotor UUID; Cloud присваивает UUID. Ответ сохраняется у нас. Все последующие изменения идут PUT по сохранённому UUID. Для восстановления после потерянного ответа CREATE используется стабильный `article_number=sc-<productId>`.

UUIDv5 используется только для нашего `ProductExtra`, а не для Evotor product UUID.

Дополнительная конфигурация товара передаётся через официальный v1 endpoint:

```text
POST /api/v1/inventories/stores/{store-id}/products/extras
```

JSON рецепта/топпингов хранится в 6.7 backend и передаётся в поле `data` ProductExtra с именем `sixthcup`.

## 8. Магазины с HTTP 402

Если Evotor возвращает:

```text
402 application is not paid/installed on all devices
```

это не должно останавливать опрос остальных магазинов. Backend помечает конкретный магазин `ERROR` и продолжает обработку остальных.
