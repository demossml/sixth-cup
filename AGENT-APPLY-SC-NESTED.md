# Apply nested sc fix

Copy into sixth-cup repo root:

- backend/src/integrations/evotor/loyaltyExtras.ts (new)
- backend/src/integrations/evotor/sync/PollService.ts
- backend/src/integrations/evotor/processing/SellHandler.ts
- backend/src/__tests__/loyalty-extras.test.ts
- CHANGELOG-SC-NESTED-FIX.md

Do not replace whole monorepo from an incomplete extract — only these paths.
