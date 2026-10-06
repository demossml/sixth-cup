# 6.7 Coffee — current implementation summary

This file supersedes the older customer-mechanics notes that described SMS login and a standalone cashier catalog.

## Current customer flow

- Anonymous guest account; phone/SMS is not required.
- Signed customer QR is the preferred loyalty identifier.
- Numeric short card code is a supported fallback for barista manual entry or numeric scanner output.
- Card code is normalized server-side; loyalty is applied only after fiscal SELL polling.

## Current Evotor catalog flow

- Evotor Cloud is authoritative for store/employee/base product records.
- A new 6.7 product is first created locally with no Evotor UUID.
- Cloud CREATE assigns the Evotor product UUID; 6.7 persists it per store.
- Later changes use PUT with the saved UUID and never CREATE a duplicate.
- A stable `articleNumber=sc-<localProductId>` recovers a product when a CREATE response is lost.
- Existing Evotor-only products are imported/upserted by `(store_uuid, evotor_uuid)`.
- Recipe/toppings/business metadata are pushed as `ProductExtra`.
- APK reads terminal inventory + `ProductExtra`; it has no hardcoded product catalog.

## Current fiscal flow

- APK returns an Evotor `Position` through `ru.evotor.createPosition`.
- EvotorPOS remains responsible for the receipt and fiscalization.
- Backend processes the resulting Cloud `SELL` through polling and `SellHandler`.

## Validation

The source tree has passed migration and syntax-level checks in the current working environment. A full Android Gradle build still requires an available Gradle 8.2 distribution and the actual SDK/dependency artifacts. The final physical gate is testing on the real ST5 terminal and Evotor Cloud.
