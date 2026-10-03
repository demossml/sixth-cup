# POST /api/devices/sales

Header: X-Device-Token

Body:
```json
{
  "cardToken": "<card proof from guest>",
  "fiscalId": "unique-per-payment",
  "amountRub": 350,
  "useFree": false,
  "cashbackUseRub": 0,
  "items": [{ "productId": 1, "name": "Латте", "qty": 1, "priceRub": 190 }]
}
```

Idempotent on deviceId+fiscalId. Returns new card proof + balances.
