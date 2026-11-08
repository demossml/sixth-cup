# ORDER-PWA-FINAL-REPORT

## Status
Implementation package for pre-order (PWA + server) delivered as additive modules.

## What was added

### Backend
- `backend/src/db/migrations/040_preorder_orders.sql` — tables preorders / preorder_items / preorder_item_modifiers
- `backend/src/modules/orders/types.ts` — statuses, DTO
- `backend/src/modules/orders/service.ts` — create, resolve, transitions, QR payload `ord1.*`, expire-on-read
- `backend/src/modules/orders/routes.ts` — guest `/api/orders`, device `/api/devices/orders/*`
- `backend/src/app.ts` — routes mounted
- `backend/src/__tests__/preorder-service.test.ts` — vitest suite (requires better-sqlite3)

### Frontend
- `frontend/src/lib/preorderApi.ts` — API + session cart
- `frontend/src/components/order/OrderQrScreen.tsx` — QR, code, timeline, polling 5s
- `frontend/src/components/order/CartSheet.tsx` — cart UI + «Собрать заказ»

### Integration remaining in host app
1. In Menu page: wire product sheet → cart; open CartSheet; on submit call `createPreorder` then show `OrderQrScreen`.
2. Do **not** change title/home screen.
3. Ensure guest auth cookie/JWT is sent (`credentials: 'include'`).
4. Apply migration `040_preorder_orders.sql` (or rely on `ensurePreorderTables` at runtime).
5. Set `ORDER_QR_SECRET` or reuse `JWT_SECRET` in env.

## API summary
| Method | Path | Role |
|--------|------|------|
| POST | /api/orders | guest create draft |
| GET | /api/orders/:id | guest status |
| POST | /api/orders/:id/cancel | guest cancel draft |
| GET | /api/devices/orders/resolve | device |
| GET | /api/devices/orders/active | касса: `X-Device-Token` **или** `X-Evotor-Store-Uuid` (прокси Эвотор) |
| PATCH | /api/devices/orders/:id/status | device |
| POST | /api/devices/orders/:id/reject | device |
| POST | /api/devices/orders/:id/mark-paid | device |

## Status machine
draft → accepted → cooking → ready → paid  
Also: cancel (draft only), reject (draft|accepted|cooking), expired (TTL 30m)

## Verification checklist
- [ ] Migration applies
- [ ] POST create returns qrPayload starting with ord1.
- [ ] Resolve by oid/code from device auth
- [ ] Invalid transition returns 409
- [ ] Title screen file unchanged
- [ ] Vitest preorder-service passes with better-sqlite3

## Known limitations
- Volume/milk prices: server uses base product price; extend `resolveLine` when full modifier catalog is wired.
- QR image uses external API in OrderQrScreen; swap for local `qrcode` lib in production if offline required.
- mark-paid must be called from cashier after SELL (endpoint ready).
