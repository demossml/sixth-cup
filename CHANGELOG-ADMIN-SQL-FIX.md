# Fix: admin redesign SQL + ADMIN_ALLOW_RESET

## Runtime 500s (prod schema mismatch)

1. `evotor_stores.status` did not exist → use `evotor_sync_state.status` (`st.status`).
2. `cards.card_id` did not exist → lookup via `users.card_id` only.

## ADMIN_ALLOW_RESET

- `config.adminAllowReset` = true only if env `ADMIN_ALLOW_RESET` is `1` or `true`.
- `POST /api/admin/reset` returns 403 when flag is off (prod default).

## Verify after deploy

```bash
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" https://admin.67coffee.ru/api/admin/dashboard | head
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" https://admin.67coffee.ru/api/admin/evotor/health | head
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "https://admin.67coffee.ru/api/admin/operations?limit=5" | head
```

Expect 200 + JSON with sellCount / stores / items.
