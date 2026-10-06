# 6.7 — manual card + Evotor catalog final

- Restored manual short card-number entry in the Evotor APK alongside signed QR.
- Android accepts digits-only manual input and digit-only scanner results; signed QR still requires Ed25519 verification.
- `extras.sc.c` carries either the signed token or the short numeric code; `kind` is informational.
- Android version is `versionCode 53`, `versionName 2.3.2-evotor-catalog`.
- New products are created in 6.7 Admin first; Evotor Cloud assigns the product UUID on first CREATE; the returned UUID is saved per store.
- Later product changes use PUT by the saved UUID; lost CREATE responses are recovered by stable `article_number=sc-<local-product-id>` before retrying CREATE.
- Existing Evotor products are upserted by `(store_uuid, evotor_uuid)`; imported records are marked `EVOTOR_IMPORT`.
- Recipe, toppings, cup/loyalty flags, seasonality and custom JSON are synchronized as 6.7 ProductExtra and read on the terminal via InventoryApi.
- APK has no hardcoded Catalog/Cart and returns a real Evotor Position through `ru.evotor.createPosition`; Evotor remains responsible for fiscalization.
- Loyalty remains server-side: after fiscal SELL, Poll + SellHandler resolve signed QR or manual card code and apply idempotent loyalty operations.
