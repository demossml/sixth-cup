# Admin → brand.67coffee.ru (полная перекладка)

Скрин до: тёплый крем, почти чёрный сайдбар, тёмная вуаль справа.
После: White/Ice фон, Primary Blue сайдбар #0B4A8D, без крема/карамели.

## Палитра
Primary #0B4A8D · Bright #1769FF · Deep #073561 · Ice #F0F6FF · White #FFF · Ink #101B2D · Border #D9E6F5

## Запрещено по брендбуку (убрано)
Коричневый, песочный, кремовый, бежевый, тёплые тени, amber CTA.

## Файлы
- frontend-admin/src/styles/coffee.css (токены + force chrome)
- frontend-admin/public/ui/coffee.css
- frontend-admin/src/styles.css
- frontend-admin/src/styles/fonts-audit.css
- frontend-admin/public/fonts/brand/*.woff2
- frontend-admin/src/layout/Shell.tsx (mobile drawer)

## Доводка до брендбука (типографика + остатки крема)

Предыдущий проход дал палитру, но шрифты и часть фонов оставались небрендовыми.

**Шрифты.** `coffee.css` просил `Golos Text`/`Unbounded`, но `@font-face` жил только в `src/styles/fonts-audit.css` (его грузит лишь React-приложение `classic.html`). Статическая главная `/` (`index.html`) подключает `public/ui/fonts.css` — там были только Manrope и JetBrains Mono, поэтому вся типографика падала в `system-ui`, а `/fonts/brand/*` не запрашивались вовсе. Объявления добавлены в `public/ui/fonts.css` с диапазонами как на brand.67coffee.ru: Unbounded `400 700`, Golos Text `400 600`.

**Иерархия (раздел 06 «Типографика»).** Unbounded 600 — заголовки страниц/панелей/дровера и крупные цифры (KPI, strip, chart total, суммы), tracking −0,02…−0,03 em, `tabular-nums`. Golos Text — интерфейс. JetBrains Mono оставлен только для плотных числовых колонок таблиц и микро-капса — это осознанное отступление от правила «не больше двух шрифтов», иначе ломается выравнивание сумм.

**Квадратная точка.** В словесном знаке между 6 и 7 теперь квадрат 0,16 em на baseline вместо точки: `.brand-dot` в сайдбаре, шапке PWA-превью и гейте логина (index.html, Shell.tsx, public/ui/sc-api.js).

**Крем.** Убраны нейтральные тёплые фоны: `.mobile-nav` и `.inv-top` (`rgba(255,253,248,…)` → белый), `.topbar` (`rgba(245,240,230,.9)`), `.thumb.photo`, `.schedule-table .is-today`, `.stock-bar-col:hover`, `.no-norm-row`, `.inv-sheet th`, `.batch-detail-row`, `.expiry-card.*`, тёплый текст в `.avatar` и `.chart-tip`. Гейт логина был на `var(--bg,#faf6ec)` → `var(--page,#FFFFFF)`, радиус 16 → 14 px, рамка фокуса поля — Bright Blue вместо UA-янтаря. Статусные amber/red-токены сохранены: это семантика, а не «бумажный» крем.

**Тёмная полоса у правого края (найдена и устранена).** Виноваты были не скроллбары, а тени закрытых drawer-ов: `.drawer { box-shadow: -12px 0 32px rgba(7,53,97,.12) !important }` висела на базовом классе, хотя закрытый drawer сдвинут на `translateX(102%)` за экран. 15 таких слоёв складывались, и их тени светили внутрь вьюпорта — полоса ~35 px во всю высоту с цветом `rgba(7,53,97)`, ровно 3–4 % ширины. Теперь у закрытого `.drawer` `box-shadow: none`, тень появляется только у `.is-on`/`.open`. Проверка по пикселям: было `(245,245,245) → (125,139,164)`, стало `(255,255,255)` до самого края; закрытых drawer-ов с тенью — 0.

**Скроллбар.** Нативный скроллбар-хром у основного скроллера скрыт (`scrollbar-width: none`), прокрутка колесом/клавишами работает — чтобы в браузерах с классическими скроллбарами справа не появлялась серая полоса.

## Деплой
Обязательно: rebuild frontend-admin + сброс CDN/cache. Иначе в браузере останется старый CSS.
