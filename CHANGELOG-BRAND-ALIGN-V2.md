# Brand align v2 — brand.67coffee.ru

Источник истины: https://brand.67coffee.ru/assets/css/base.css

## Палитра
| Token | HEX |
|-------|-----|
| Primary | #0B4A8D |
| Bright | #1769FF |
| Deep | #073561 |
| Tiffany | #55D6C2 |
| White | #FFFFFF |
| Ice | #F0F6FF |
| Pale | #DCEBFF |
| Ink | #101B2D |
| Muted | #586B82 |
| Border | #D9E6F5 |

Убраны тёплые «бумага» #F6F3EE, крем #C8A26E, старый кобальт #002FA7.

## Типографика
- Display: **Unbounded**
- Body: **Golos Text**
Шрифты: `frontend/src/assets/fonts/brand/*.woff2` (с brand.67coffee.ru).

## Где
- `frontend/src/theme/tokens.ts`
- `frontend/tailwind.config.js`
- `frontend/src/styles.css` (fonts + hero gradients)
- `frontend-admin/src/styles/coffee.css` (+ public/ui/coffee.css)

## Не трогали
- Backend / Evotor APK
- Игровая логика alpaca (только косвенно через CSS-классы страниц)
