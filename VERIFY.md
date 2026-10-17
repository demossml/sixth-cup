# admin-audit-fixes-verified

Основа: `admin-audit-fixes.zip` (исправления по ADMIN_AUDIT_REPORT).

## Проверка Grok
- Все P1/часть P2 из отчёта приняты как корректные.
- Клиентский PWA в этом overlay не трогался.
- Дополнительно: `MANAGER_BLOCKED` принимает и полный path `/api/admin/stores`, и короткий `/stores` (на случай stripped path в Hono).
- Тесты regex обновлены под оба варианта.

## Допущения ролей (как в исходном фиксе)
- manager = контент + аналитика (не точки/кассы/ИИ/grant-all)
- телефон: owner + manager, с записью в audit; viewer — 403

## Накат
См. APPLY.txt
