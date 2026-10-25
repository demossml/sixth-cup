# Admin mobile + brand

Источник: brand.67coffee.ru (Primary #0B4A8D, Ice, White, без тёплой бумаги).

## Мобильная вёрстка
- Off-canvas drawer: transform, не display:none (меню открывается с гамбургера).
- Backdrop rgba(7,53,97,.42), z-index поверх контента.
- На ≤900px подписи пунктов меню снова видны.
- main-scroll: 14px + safe-area, без горизонтального вылезания.
- Таблицы: overflow-x auto, min-width 520px.
- Topbar sticky + safe-area-inset-top.
- Поиск растягивается на ширину.
- Закрытие drawer при смене route + lock body scroll.
- Убрана дублирующая mobile-nav панель (навигация через drawer).

## Файлы
- frontend-admin/src/styles/coffee.css
- frontend-admin/public/ui/coffee.css
- frontend-admin/src/layout/Shell.tsx
