# Админка: группы + добавки (топпинги)

## UI (frontend-admin AdminPage)

| Вкладка | Возможности |
|---------|-------------|
| **Группы** | Создать / изменить / удалить категорию меню |
| **Добавки** | Справочник сиропов/топпингов/молока + **наборы (схемы)** с копированием |
| **Товары** | Поля «Группа» и «Набор добавок» в карточке |

## Backend (уже в проекте)

- `GET/POST/PATCH/DELETE /api/admin/categories`
- `GET/POST/DELETE /api/admin/modifiers`
- `GET/POST/DELETE /api/admin/modifier-schemes`
- `POST /api/admin/products` с `categoryId`, `modifierSchemeId`
- ProductPushService кладёт toppings в ProductExtra при sync

## Касса (следующий этап)

Чтение ProductExtra.toppings + цена /100.
