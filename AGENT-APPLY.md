# Админка: группы + топпинги

Архив: `sixth-cup-admin-groups-toppings.zip`

1. Распаковать поверх monorepo sixth-cup
2. Заменить `frontend-admin/src/pages/AdminPage.tsx`
3. Backend routes categories/modifiers уже должны быть (из admin-tz / final). Если нет — взять из sixth-cup-admin-tz
4. `npm run build -w frontend-admin` (или turbo)
5. Commit + push GitHub

Не трогать EVOTOR_API_TOKEN / .env.
