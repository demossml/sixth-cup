# Mac mini cleanup
1. Deploy store-sync-gate code, restart API
2. Admin → Точки → галочка только на вашем магазине
3. sqlite3: DELETE products WHERE catalog_source='EVOTOR_IMPORT' (+ links)
4. POST /api/admin/evotor/sync
