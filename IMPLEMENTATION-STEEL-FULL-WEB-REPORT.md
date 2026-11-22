# IMPLEMENTATION — Steel full web

## Scope

Только внешний слой PWA гостя, админки и экрана бариста:

- `frontend` (гость)
- `frontend-admin` (админка)
- `frontend-barista` (очередь)
- общий пакет CSS-токенов `packages/ui-tokens`

Backend handlers и JSON-контракты не переписывались.

## API diffs

**none.**

Проверено:

- routes PWA без изменений
- `/api/staff/login`, `/api/staff/me`, `/api/staff/kitchen/*` без изменений
- `/api/admin/app-users` и существующие `/api/admin/*` без изменений
- `/api/devices/kitchen/*` без изменений

## Brand 67coffee

**yes.**

Во всех трех приложения установлен `<html data-brand="67coffee">`.

Бренд-оверлей в `packages/ui-tokens/tokens.css` задаёт:

- `--c-app: #17140F`
- `--c-sheet: #F6F3EE`
- `--c-paper: #FBF9F5`
- `--c-blue: #002FA7`
- `--c-blue-ring: #1A6EFF`

В PWA сохранены локальные шрифты бренда: `Golos Text` / `Unbounded`; стальные UI-токены используют брендовый шрифт без сетевого Google Fonts.

## Goo

**no.**

Goo/SVG blur не внедрены. Моргание barista реализовано обычной рамкой/box-shadow без layout-анимаций.

## Screens done

| Фаза | Результат |
|------|-----------|
| F0 tokens | `packages/ui-tokens/tokens.css` и `steel.css`, подключены во все три приложения |
| F1 PWA shell | `app-frame/app-sheet`, пилюля навигации 256×72, safe-area, десктопная рамка 520 px |
| F2 menu list | Steel-карточки гостя, заголовки секций, 2 колонки, чипы категорий 44 px |
| F3 product detail | листовая карточка товара: крупный заголовок/цена, круг back, pill-модификаторы, лист добавок |
| F4 cart/checkout chrome | Steel foot с quantity-stepper и CTA, розовый guest-CTA как визуальный акцент; реальная отправка остается прежним API |
| F5 barista | Steel/колода: login shell, номер №N крупно, yellow new, seen, green Done ≥72 px, portrait/landscape |
| F6 admin shell | shell sidebar/topbar/cards/buttons typography/spacing/radius/focus; бизнес-формы не переписаны |
| F8 motion lite | 120–320 ms, transform/opacity/ease-ios, reduced-motion off |

## API-contract regression

- Не использованы demo SKU или локальный fallback-каталог.
- Не добавлены PIN/NFC/fiscal/pay-fact экраны.
- Loyalty, catalog, preorder, sync, staff/kitchen и admin CRUD payload не менялись.
- Fixed-бар PWA карточки товара поднят над новой навигацией на 5.5rem, чтобы не перекрывать «В заказ».
- Плашка установки скрывается на экранах с собственной панелью действия (`/menu/:id`, `/cart`, `/pick-store`, `/promo/:id`), чтобы не перекрывать CTA.

## Visual verification

- PWA 390×844: главная, меню, карточка товара и корзина открываются, навигация-пилюля не перекрывает CTA.
- PWA desktop: колонка остается 480 px и получает Steel-рамку из `app-sheet`.
- Бариста 390×844:
  - login показывает брендированную cream-поверхность и pill-CTA;
  - реальный заказ №3 получает yellow ring/blink;
  - tap → `seen` и ring off;
  - Done → активная карточка исчезает.
  - узкие <=379 px: «Моргание» и «Выйти» компактны.
- Admin: shell-polish добавлен поверх существующих CSS без изменения handlers/pages.

## Test counts

До редизайна:

- frontend: 13 files / 145 tests
- frontend-admin: 35 files / 332 tests
- frontend-barista: 2 files / 9 tests
- backend: 152 files / 1160 tests

После STEP-9 guard:

- frontend: 13 files / 145 tests, green
- frontend-admin: 35 files / 332 tests, green
- frontend-barista: 2 files / 9 tests, green
- backend: 152 files / 1160 tests, green
- Turbo: 9 tasks successful (typecheck/build для всех workspaces), green

## Known gaps

- Структура экрана бариста переделана только внешне; реальная очередь продолжает зависеть от APK-пути создания `kitchen_orders`.
- Admin shell-polished, плотные legacy-таблицы и сложные формы намеренно не переписывались.
- Goo эффекты и flight-animation не внедрены: контракт/процентное качество на слабых Android важнее.
- Небольшая сетка на ширине <=379 проверяется CSS, но требует финального устройства на точке.
- APK не входил в scope.

## WHAT I DID NOT DO

- backend business logic
- API/SQL migration
- loyalty earn/spend
- catalog/configuration
- Evotor fiscal/nomenclature/push
- APK / receipt / PIN / local demo catalog
- NFC/pay/fiscal «Оплата прошла»
