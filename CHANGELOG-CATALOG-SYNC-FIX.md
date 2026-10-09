# Catalog sync fix

- Isolated extras failures from product writes; extras are disabled by default via `EVOTOR_PUSH_EXTRAS=0` and have an explicit opt-in flag.
- Preserved outbox retry deadlines on enqueue and changed product retry delay to 1/2/5/15/60 minutes.
- Validated store-specific links against remote catalog, recreated stale mappings, and kept Cloud-generated IDs as the only IDs for new products.
- Removed the per-product AssignmentSync write path from the admin route; it now delegates to the catalog pipeline.
- Added honest per-store sync summaries and admin feedback; selective wipe only targets 6.7-owned products.
- Added catalog-sync and production-facts documentation.
