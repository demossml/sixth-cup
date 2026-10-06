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
3. Открыть продажу.
4. Вызвать скидку 6.7 Coffee.
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

`c` — подписанный QR клиента. Backend повторно проверяет его подпись и срок действия. Нельзя доверять числовым значениям `free`, `cb` или `disc` без проверки состояния карты.

## 6. Что не используется

Не использовать как обязательную часть текущего контура:

- `/api/v1/user/create`;
- `/api/v1/user/verify`;
- `/api/v1/user/token`;
- SMS;
- прямой HTTPS с APK на backend;
- Evotor proxy для loyalty;
- ручной ввод номера карты.

## 7. Номенклатура

Источник истины — backend.

Для товара используется детерминированный UUIDv5:

```text
UUIDv5(namespace, storeUuid + ':' + productId)
```

При изменении товара запись попадает в `evotor_outbox`.

Дополнительная конфигурация товара может передаваться через официальный v1 endpoint:

```text
POST /api/v1/inventories/stores/{store-id}/products/extras
```

JSON рецепта/топпингов хранится в `products.evotor_extra_json`.

## 8. Магазины с HTTP 402

Если Evotor возвращает:

```text
402 application is not paid/installed on all devices
```

это не должно останавливать опрос остальных магазинов. Backend помечает конкретный магазин `ERROR` и продолжает обработку остальных.
