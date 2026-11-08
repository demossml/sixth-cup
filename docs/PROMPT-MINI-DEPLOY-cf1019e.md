# ПРОМПТ АГЕНТУ НА MINI: выкладка `sixth-cup` → `cf1019e`

Ты — агент на **Mini** (production, `67coffee.ru`). Код приходит только через GitHub
`demossml/sixth-cup`, ветка `main`. Задача: забрать `main` до **`cf1019e`**, собрать, применить
миграции, перезапустить сервис и подтвердить три вещи: (1) касса видит заказы, (2) «Принять»
на кассе отвечает 200, (3) в карточке клиента есть снятие бана за невыкуп.

**Новых миграций в этом шаге нет** (последняя — `055_preorder_indexes`). Схему БД не менять.

## 0. Правила

1. Бэкап БД обязателен (шаг 1). Без бэкапа дальше не идти.
2. `.env` **не трогать** — новых переменных нет.
3. Не удалять `data/`, `uploads/`, `keys.json`, `.env`.
4. Секреты (`ADMIN_TOKEN`, `JWT_SECRET`, `VAPID_PRIVATE_KEY`, `EVOTOR_PROXY_TOKEN`) не печатать.
5. Расхождение с промптом (путь/порт/менеджер сервиса) — зафиксируй в отчёте, дальше по факту.

## 1. Что должно быть в `main`

```bash
git fetch origin && git log --oneline -4 origin/main
```

Ожидаемо сверху:

```
cf1019e fix(orders): «Принять» на кассе — POST /orders/:id/status (Android не умеет PATCH)
8a945f4 feat(admin): снятие бана за невыкуп из карточки клиента
1491dd8 docs(deploy): промпт агенту на Mini …
e0becb2 fix(orders): касса видит заказы без enroll …
```

Если `e0becb2` ещё не выложен — просто выкладываем сразу `cf1019e` (всё входит).

## 2. Выкладка

```bash
cd ~/apps/sixth-cup                    # фактический путь — свой
sqlite3 backend/data/sixth-cup.db ".backup backend/data/backup-$(date +%Y%m%d-%H%M%S).db"
sqlite3 backend/data/backup-*.db "PRAGMA integrity_check;" | tail -1     # ok
git status --porcelain                 # пусто, иначе СТОП + описать
git pull --ff-only origin main
git rev-parse --short HEAD             # cf1019e
npm ci
npm run typecheck                      # 3/3
npm run build                          # 3/3
cd backend && DB_PATH=$(mktemp -u /tmp/preflight-XXXX.db) npx vitest run 2>&1 | tail -4
cd ..
```

Ожидаемо тестов: **106 файлов / 728 тестов pass**. Красные тесты → прод не перезапускать,
прислать хвост лога.

Перезапуск (менеджер — свой, как в прошлый раз):

```bash
# launchctl kickstart -k "gui/$(id -u)/<label>"   |   systemctl --user restart <unit>   |   pm2 restart <name>
```

В логе старта: сервис поднялся, ошибок миграций нет.

## 3. Проверки (главное)

Нужен uuid точки кассы:

```bash
sqlite3 -header backend/data/sixth-cup.db "SELECT store_uuid, local_store_id FROM evotor_stores;"
```

Если `local_store_id` пустой — привяжи точку (иначе будет `404 unknown_store`):

```bash
curl -s -X POST "http://127.0.0.1:3001/api/admin/stores/$STORE_ID/link" \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d "{\"storeUuid\":\"$UUID\"}"
```

Если в `.env` задан `EVOTOR_PROXY_TOKEN` **и** `EVOTOR_PROXY_ENFORCE=1`, добавь к запросам
`-H "Authorization: Bearer $EVOTOR_PROXY_TOKEN"`.

### 3.1 Список заказов кассы

```bash
curl -s -i "http://127.0.0.1:3001/api/devices/orders/active" -H "X-Evotor-Store-Uuid: $UUID" | head -5
```

Ожидаемо `200` + `{"ok":true,"orders":[…]}`.

### 3.2 «Принять» на кассе (новый фикс)

Возьми id любого активного заказа из 3.1 (или создай предзаказ из PWA, чтобы был `draft`):

```bash
# ровно так шлёт касса: POST + override (Android не умеет PATCH)
curl -s -i -X POST "http://127.0.0.1:3001/api/devices/orders/$ORDER_ID/status" \
  -H "X-Evotor-Store-Uuid: $UUID" -H 'content-type: application/json' \
  -H 'X-HTTP-Method-Override: PATCH' -d '{"status":"accepted"}' | head -5
```

Ожидаемо `200` и `"status":"accepted"` в теле. `404` — регресс, прислать ответ целиком.
Проверь и обычный `PATCH` тем же URL — тоже `200`.

### 3.3 Карточка клиента со снятием бана

```bash
curl -s "http://127.0.0.1:3001/api/admin/customers/$USER_ID" -H "X-Admin-Token: $ADMIN_TOKEN" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('preorderBan=',d.get('preorderBan'))"
```

Ожидаемо поле присутствует (`null` или объект `until/reason/orderId`). В самом интерфейсе:
админка → Клиенты → клиент → блок «Предзаказ» с кнопкой «Снять бан».

Проверка снятия (если есть активный бан):

```bash
curl -s -X POST "http://127.0.0.1:3001/api/admin/preorder/bans/$USER_ID/lift" -H "X-Admin-Token: $ADMIN_TOKEN"
# {"ok":true,"lifted":true}
```

### 3.4 Живость

```bash
curl -s -o /dev/null -w "health %{http_code}\n" http://127.0.0.1:3001/health
curl -s -o /dev/null -w "pwa %{http_code}\n"   http://127.0.0.1:3001/
curl -s -o /dev/null -w "admin %{http_code}\n" http://127.0.0.1:3001/
```

## 4. Проверка руками на терминале

1. Открыть «Заказы» — список виден (не 401).
2. Новый предзаказ из PWA → на кассе «Принять» → статус «Готовится», у гостя в PWA «Принят».
3. В админке в карточке гостя видно бан (если он есть) и кнопку «Снять бан»; после нажатия гость
   снова может заказать.

## 5. Откат

```bash
git reset --hard e0becb2      # или предыдущий рабочий SHA
sqlite3 backend/data/sixth-cup.db ".restore backend/data/backup-<TS>.db"   # при необходимости
# перезапуск тем же способом
```

## 6. Отчёт

1. SHA до/после, `git status --porcelain`.
2. Бэкап: путь, размер, integrity.
3. typecheck/build/тесты: числа.
4. 3.1 — статус и тело (сокращённо). 3.2 — статус и `"status"` из ответа (для POST и PATCH).
5. 3.3 — `preorderBan` и результат lift (если проверял).
6. Расхождения с промптом. 7. «Касса принимает заказы: да/нет».
