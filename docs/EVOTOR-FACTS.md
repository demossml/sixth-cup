# Evotor Cloud verified facts

Production diagnostic (2026-10-08): with the configured 36-character token, direct requests to `api.evotor.ru` returned HTTP 200 for v1/v2 product reads, HTTP 200 for v2 product create and replace, and HTTP 204 for product delete. `POST /api/v1/inventories/stores/{store}/products/extras` returned HTTP 403 with an empty body. Keep working product-write headers (`X-Authorization` and JSON content type) unchanged unless a new verified test supports a change.

Known test store: `20260929-0936-40D2-802D-CACB2BB08488` (“Мой магазин”), `sync_enabled=1`. Default app UUID: `151071e8-88a4-44f6-b71a-b17c559f9b7d`. Do not put tokens or database files in source control.
