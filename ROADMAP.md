# Roadmap — current status

## ✅ Evotor catalog foundation

- Evotor Cloud stores/employees/catalog are available to the admin.
- New 6.7 products are created locally, then Cloud CREATE returns the Evotor UUID.
- UUID is persisted per store and reused for PUT updates.
- Lost CREATE responses are recovered by stable `articleNumber=sc-<localProductId>`.
- Existing Evotor products are imported/upserted by store + Evotor UUID.
- ProductExtra carries 6.7 recipe/topping/business metadata.

## ✅ Android Evotor integration foundation

- Package `ru.sixthcup.evotor`.
- No hardcoded product catalog.
- Local terminal inventory is read through `InventoryApi`.
- `ru.evotor.createPosition` adds the selected existing Evotor product to the active receipt.
- Signed QR and numeric card-code loyalty channels are supported.

## ✅ Server-side fiscal loyalty

- Cloud polling receives SELL/PAYBACK.
- `SellHandler` is idempotent and resolves signed QR or numeric card code.
- Loyalty state is updated only from fiscal documents.

## ⬜ Physical release verification

- Build and install final APK on the real ST5.
- Verify Cloud CREATE → UUID persistence → terminal inventory.
- Verify ProductExtra recipe/toppings on terminal.
- Verify position insertion into Evotor receipt.
- Verify `extras.sc` survives fiscal SELL and is visible to Cloud polling.
- Verify PAYBACK and retry scenarios.
