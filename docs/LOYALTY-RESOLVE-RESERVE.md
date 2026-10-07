# Loyalty: resolve + reservation

## Flow
1. Guest shows QR (identity token) or short code — phone may be offline.
2. APK POST https://app.67coffee.ru/api/loyalty/resolve `{ "c": "<token|code>" }`
3. Backend verifies identity, returns live cups/cashback, reserves FREE_CUP ~90s (`R-…`).
4. APK shows barista state; on sale writes extras.sc `{ v:2, c, op: reservationId }`.
5. Evotor Cloud SELL → Poll → SellHandler → consumeReservation(op) + accrue loyalty.

## Endpoint
POST /api/loyalty/resolve (no JWT; rate-limit recommended in prod)

## Table
loyalty_reservations (migration 010)
