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

## Деплой
Обязательно: rebuild frontend-admin + сброс CDN/cache. Иначе в браузере останется старый CSS.
