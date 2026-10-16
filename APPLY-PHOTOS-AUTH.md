# Backend — photos / catalog for Evotor cashier

## Fixes
1. **GET /api/devices/catalog** — no longer requires EVOTOR_PROXY_TOKEN / no 503 when token unset; not behind `evotorProxyStrict`. Loyalty stays strict.
2. **GET /api/devices/images/:file** — same (public product photos).
3. **deviceImageUrl** — always absolute HTTPS using `PUBLIC_BASE_URL` or fallback `https://app.67coffee.ru`.
4. **POST /api/admin/upload** — always returns absolute URL (same fallback).

## Env (recommended)
```
PUBLIC_BASE_URL=https://app.67coffee.ru
EVOTOR_PROXY_TOKEN=<secret for loyalty via Evotor cloud>
# EVOTOR_PROXY_ENFORCE=1  # still protects /api/devices/loyalty/*
```

## Verify
```
curl -sS https://app.67coffee.ru/api/devices/catalog | head
# expect 200, products[].imageUrl like https://app.67coffee.ru/api/devices/images/...
# expect products[].evotorUuid non-null for items that should show photos on till
```
