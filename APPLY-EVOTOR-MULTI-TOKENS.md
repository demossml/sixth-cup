# Evotor multi-tokens + store sync UI

## Что в архиве
1. **Мульти-токены** cloud API в админке (Касса → «Токены Эвотор»):
   - таблицы `evotor_api_tokens`, `evotor_token_stores`
   - шифрование at rest (`TOKEN_ENCRYPTION_KEY` или `JWT_SECRET`)
   - API: GET/POST/PATCH/DELETE `/api/admin/evotor/tokens`, POST `…/probe`
   - poll: `ensureStores` по всем active tokens; `pollStore` с токеном точки
2. **Синк точек**: страница Касса — переключатель «Синхронизация» у каждой точки (уже был API PATCH; UI усилен, показан uuid).
3. Env `EVOTOR_API_TOKEN` остаётся fallback и импортируется один раз как `env-legacy`.

## Деплой
```bash
# overlay backend + frontend-admin
cp -R backend/. <repo>/backend/
cp -R frontend-admin/. <repo>/frontend-admin/
cd <repo>/backend && npx vitest run  # по возможности
cd ../frontend-admin && npm run build
# рестарт backend + выкладка dist
```

## После деплоя
1. Админка → Касса → **выключить sync** у `20260929-0936-…` (404).
2. Добавить токен нового кабинета, привязать uuid **нового** магазина, «Проверить».
3. Включить sync только у актуальной точки.
