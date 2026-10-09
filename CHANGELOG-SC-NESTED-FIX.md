# Fix: nested extras[appId].sc for Evotor loyalty

## Problem
APK writes loyalty as `extras["151071e8-88a4-44f6-b71a-b17c559f9b7d"].sc`.
Backend only looked at `extras.sc` → SELL marked PROCESSED without handleSell → loyalty_ops always empty.

## Change
- `backend/src/integrations/evotor/loyaltyExtras.ts` — extractScRaw / hasLoyaltySc
- `PollService.processDocument` — hasLoyaltySc(extras); log skip without sc
- `SellHandler.getSc` — extractScRaw(doc.extras)
- test: `loyalty-extras.test.ts`

## Deploy
Apply files onto current sixth-cup backend, typecheck/test/build, restart API.
New SELL with card from 6.7 should log `evotor SELL processed` and grow loyalty_ops.

## Optional reprocess
Old PROCESSED docs need refetch from Evotor API (wl_json has transactions as length only) then handleSell again.
