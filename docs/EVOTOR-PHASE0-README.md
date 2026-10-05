# Evotor integration — Phase 0/1 code

Added under `backend/src/integrations/evotor/`:

- `EvotorClient` — X-Authorization, V2 Accept, retries
- `migrateEvotorSchema` — tables from MASTER-TZ
- `PollService` — stores + document poll (no loyalty yet)
- `scripts/evotor-probe.ts` — Phase 0 checks
- `docs/EVOTOR-FACTS.md` — fill before SellHandler

## Run probe

```bash
cd backend
export EVOTOR_API_TOKEN='…'   # never commit
npm run evotor:probe
```

## Not done yet (blocked by FACTS 0.6)

- SellHandler / PaybackHandler loyalty
- Product outbox sync to cloud
- Android QR+Discount production rewrite
