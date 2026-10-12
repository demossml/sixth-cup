# Полное закрытие RESEARCH-CLIENT-ADMIN-LEAP

## Восстановлено / добавлено в этом архиве

| Пункт | Реализация |
|-------|------------|
| **Device catalog** | `GET /api/devices/catalog` + `docs/DEVICE-CATALOG-API.md` (toppings, upsell, images, evotorUuid) |
| P0.3 Quality | API + Today |
| P0.4 CMS content | promos CMS + PWA card |
| P0.5 Today | exceptions, coverage note, yesterday |
| P0.6 Business events | API + страница `/events` |
| P0.2 History | ops+referral (уже было) |
| P1.1 Availability | API + тогглы в товаре |
| P1.3 Schemes | preview API + UI «Просмотр» / копирование |
| P1.4 Referrals | API + страница |
| P1.5 Favorite drink | localStorage |
| P1.6 Compare | страница `/compare` два периода |
| P1.7 Roles | `ADMIN_VIEWER_TOKEN` → role viewer, только GET; owner = ADMIN_TOKEN; `GET /api/admin/me` |

## Не автоматизировано (нужен человек)

- P0.1 полевой тест QR на ST5
- P0.7 полный offline QA на реальных телефонах
- P2 (push, Wallet, order-in-app)

## Касса

**Не удалять** `/api/devices/catalog` при merge с leap — эндпоинт снова в этом архиве.

## Проверка

```bash
npm ci && npm run typecheck && npm run test -w backend && npm run build
```

Auth catalog: `Authorization: Bearer $EVOTOR_PROXY_TOKEN`
