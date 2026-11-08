# ПРОМПТ АГЕНТУ НА MINI: выкладка `sixth-cup` → `e0becb2`

Ты — агент на машине **Mini** (production, `67coffee.ru`). Кода этой машины у меня нет: изменения
приходят **только** через GitHub `demossml/sixth-cup`, ветка `main`.

Цель: забрать `main` до **`e0becb2`**, собрать, применить миграции, перезапустить сервис и
подтвердить, что экран «Заказы» на кассе больше не отдаёт `401 Unauthorized`.

Ничего сверх этого не менять: `.env`, ключи, `uploads/`, содержимое БД — не трогать.

---

## 0. Жёсткие правила

1. **Бэкап БД обязателен** до любых действий (шаг 2.1). Без бэкапа дальше не идти.
2. `.env` **не перезаписывать** целиком. В этом релизе новые переменные **не обязательны**
   (есть дефолты), поэтому `.env` трогать не нужно вообще.
3. Миграции — только тем механизмом, который уже есть в приложении (при старте сервиса).
   В БД руками ничего не писать, кроме проверки `SELECT` (и шага 4.2 — привязка точки через API).
4. Не удалять `data/`, `uploads/`, `keys.json`, `.env`.
5. Секреты (`ADMIN_TOKEN`, `JWT_SECRET`, `VAPID_PRIVATE_KEY`, `EVOTOR_PROXY_TOKEN`) не выводить
   в чат/лог/отчёт.
6. Если факт расходится с промптом (путь, порт, менеджер сервиса) — **зафиксируй расхождение
   в отчёте** и продолжай по фактическому окружению. Если расхождение ломает выкладку — остановись.
7. Пуш/деплой делать без «заодно»: рефакторинг, редизайн, правки конфигов не входят в задачу.

---

## 1. Что должно быть в `main` перед стартом

```bash
git fetch origin && git log --oneline -3 origin/main
```

Ожидаемо верхушка:

```
e0becb2 fix(orders): касса видит заказы без enroll — авторизация по X-Evotor-Store-Uuid
8032c7f fix(audit): волны 0–3 …
```

Должны существовать файлы (проверь `ls`):

- `backend/src/db/migrations/050_device_enroll_security.sql` … `055_preorder_indexes.sql` (6 новых);
- `backend/src/middleware/deviceStore.ts`;
- `backend/src/modules/orders/pricing.ts`;
- `docs/IMPLEMENTATION-AUDIT-SIXTH-FINAL-REPORT.md`.

Если чего-то нет — **СТОП**, напиши, чего не хватает.

---

## 2. Выкладка

### 2.1. Бэкап БД

```bash
# фактический путь проекта возьми из своего окружения (в прошлый раз был ~/apps/sixth-cup)
cd ~/apps/sixth-cup
TS=$(date +%Y%m%d-%H%M%S)
sqlite3 backend/data/sixth-cup.db ".backup backend/data/backup-$TS.db"
sqlite3 backend/data/backup-$TS.db "PRAGMA integrity_check;"   # ожидаем ok
ls -la backend/data/backup-$TS.db
```

В отчёт: путь, размер, `integrity_check`.

### 2.2. Код и зависимости

```bash
git status --porcelain          # должно быть пусто; если есть локальные правки — СТОП, опиши
git pull --ff-only origin main
git rev-parse --short HEAD      # ожидаем e0becb2
npm ci
```

### 2.3. Сборка и проверки (до перезапуска)

```bash
npm run typecheck                     # ожидаем 3/3
npm run build                         # ожидаем 3/3
cd backend && DB_PATH=$(mktemp -u /tmp/preflight-XXXX.db) npx vitest run 2>&1 | tail -5
cd ..
```

Ожидаемо: **105 файлов / 723 теста pass** (или больше — если добавились новые).
Если тесты красные — **не перезапускать прод**, прислать хвост лога и остановиться.

`DB_PATH` во временном файле обязателен: иначе прогон возьмёт боевую БД.

### 2.4. Перезапуск сервиса

Менеджер сервиса возьми фактический (как в прошлой выкладке):

```bash
# вариант A: launchd (user-level)
launchctl list | grep -i sixth
launchctl kickstart -k "gui/$(id -u)/<label>"

# вариант B: systemd user
systemctl --user restart <unit>

# вариант C: pm2
pm2 restart <name>
```

После старта проверь лог на применение миграций — должны появиться строки
`[migrate] applied 050_device_enroll_security` … `055_preorder_indexes` (по одной на файл).

Затем:

```bash
curl -s -o /dev/null -w "health %{http_code}\n" http://127.0.0.1:3001/health
```

---

## 3. Проверка миграций

```bash
sqlite3 backend/data/sixth-cup.db "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 8;"
```

Ожидаемо в списке: `050…055`. Если таблица называется иначе — найди её (`SELECT name FROM sqlite_master`),
в отчёт запиши фактическое имя.

Колонки, которые должны появиться:

```bash
sqlite3 backend/data/sixth-cup.db "PRAGMA table_info(devices);"        # enroll_expires_at, key_bound_at
sqlite3 backend/data/sixth-cup.db "PRAGMA table_info(preorders);"      # fiscal_document_number, paid_amount
sqlite3 backend/data/sixth-cup.db "PRAGMA table_info(stores);"         # money_scale
sqlite3 backend/data/sixth-cup.db "PRAGMA table_info(users);"          # token_version
sqlite3 backend/data/sixth-cup.db "PRAGMA index_list(preorders);"      # idx_preorders_guest_status, idx_preorders_status_expires
```

---

## 4. Проверка бага «Терминал не авторизован»

### 4.1. Узнать uuid точки и её привязку

```bash
sqlite3 -header backend/data/sixth-cup.db "SELECT store_uuid, name, local_store_id FROM evotor_stores;"
sqlite3 -header backend/data/sixth-cup.db "SELECT id, name, address FROM stores;"
```

Нужно: у точки, на которой стоит касса, `local_store_id` **не NULL** и указывает на существующий
`stores.id`.

### 4.2. Если `local_store_id` пустой — привязать (это и есть «привязка кассы к точке»)

```bash
# STORE_ID — локальный id точки, UUID — store_uuid из облака Эвотора
curl -s -X POST "http://127.0.0.1:3001/api/admin/stores/$STORE_ID/link" \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d "{\"storeUuid\":\"$UUID\"}"
# ожидаем {"ok":true}
```

Если `evotor_stores` пуст — значит каталог/точки ещё не подтянулись из облака: подожди один цикл
синхронизации (`GET /api/admin/evotor/health` → статус OK), потом повтори. В отчёт запиши факт.

### 4.3. Реальный запрос кассы (главная проверка)

```bash
curl -s -i "http://127.0.0.1:3001/api/devices/orders/active" \
  -H "X-Evotor-Store-Uuid: $UUID" -H "X-Evotor-Device-UUID: smoke-$(date +%s)" | head -20
```

Ожидаемо: `HTTP/1.1 200` и тело `{"ok":true,"orders":[…]}` (список может быть пустым).

Если в `.env` задан `EVOTOR_PROXY_TOKEN` **и** `EVOTOR_PROXY_ENFORCE=1`, добавь заголовок
`-H "Authorization: Bearer $EVOTOR_PROXY_TOKEN"` (значение не печатать).

Что означают коды, если не 200:

| Код | Причина | Что сделать |
|---|---|---|
| `401 Unauthorized` | нет `X-Evotor-Store-Uuid` и в системе не одна точка | проверить заголовок / количество точек |
| `404 unknown_store` | uuid не связан с локальной точкой | шаг 4.2 |
| `403 proxy_forbidden` | включён `EVOTOR_PROXY_ENFORCE=1`, нет/неверный `Authorization` | проверить, что облако Эвотора подставляет токен |

Дополнительно проверь, что старый путь (enroll) не сломан — только если под рукой есть device token;
если нет, пропусти и отметь в отчёте.

### 4.4. PWA и админка живы

```bash
curl -s -o /dev/null -w "pwa %{http_code}\n"  http://127.0.0.1:3001/
curl -s -o /dev/null -w "admin %{http_code}\n" http://127.0.0.1:3001/
curl -s http://127.0.0.1:3001/api/directory | head -c 120; echo
curl -s -o /dev/null -w "push-key %{http_code}\n" http://127.0.0.1:3001/api/push/public-key
```

Ожидаемо: `200`, каталог отдаёт JSON, ключ push отдаётся (если VAPID настроен ранее).

---

## 5. Что сказать владельцу после проверки (проверка с терминала)

Касса должна сама увидеть заказы без обновления APK:
1. открыть на терминале вкладку «Заказы» — вместо «Терминал не авторизован» должен появиться список
   (или «заказов нет»);
2. сделать тестовый предзаказ из PWA и убедиться, что он появился на кассе в течение 10 секунд.

Если на терминале всё ещё 401 — прислать в отчёт строку лога
`GET /api/devices/orders/active` с её заголовками (без секретов) и результат шага 4.3.

---

## 6. Откат (если что-то пошло не так)

```bash
git reset --hard <предыдущий SHA из шага 2.2>
sqlite3 backend/data/sixth-cup.db ".restore backend/data/backup-$TS.db"   # или cp бэкапа на место
# перезапустить сервис тем же способом, что в 2.4
```

Миграции 050–055 аддитивные (только `ADD COLUMN` / `CREATE INDEX` / `CREATE TABLE`), поэтому
откат кода без отката БД тоже рабочий: старый код эти объекты просто не использует.

---

## 7. Формат отчёта

1. SHA до/после (`git rev-parse --short HEAD`), `git status --porcelain` (пусто/не пусто).
2. Бэкап: путь, размер, `integrity_check`.
3. Typecheck/build: числа. Тесты: файлы/тесты pass.
4. Список применённых миграций (`050`…`055`) и подтверждение новых колонок/индексов.
5. Шаг 4.3: полный HTTP-статус и тело ответа `/api/devices/orders/active` с заголовком точки.
6. Привязка точки: был ли `local_store_id` пустым, что сделал (шаг 4.2).
7. Честные расхождения с промптом (путь, порт, менеджер сервиса).
8. «Готово к работе кассы: да/нет» + что осталось.
