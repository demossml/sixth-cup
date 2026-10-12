# CHANGELOG: визуальная концепция клиентского PWA («Кобальт и бумага»)

Только `frontend/`. Backend, API, логика QR/синхронизации/офлайна не менялись.

## Добавлено
- `frontend/src/assets/fonts/*.woff2` — Geologica (variable) и Golos Text 400/600, latin + cyrillic.
- `frontend/src/components/Illustrations.tsx` — линейные SVG для онбординга.
- `docs/PWA-VISUAL-CONCEPT.md` — описание изменений, замеры, ограничения.

## Изменено
- `tailwind.config.js`, `src/styles.css` — токены цвета/радиусов/теней, шрифты, `.hero`, `.num`, анимации, press-состояние.
- `src/pages/{CardPage,CardQrPage,MenuPage,MorePage,OnboardingPage,InvitePage,HistoryPage,ProfilePage,PromosPage,StoresPage}.tsx`.
- `src/components/{InstallBanner,Qr}.tsx` (цвет модулей QR #1B1A17, статичный плейсхолдер).
- `src/App.tsx` (нав на бумажном фоне, экран загрузки), `vite.config.ts` (`background_color` манифеста #F6F3EE).

## Проверки
`tsc --noEmit` чисто; `vitest` 10/10; `vite build` успешно (precache 19 entries, ≈ 620 КиБ); Playwright 375×700 на реальном backend: QR 300 px, номер ≤ 540 px при навигации с 643; офлайн-перезагрузка production-сборки показывает QR и шрифты; `0010` и `1111` одной ширины.
