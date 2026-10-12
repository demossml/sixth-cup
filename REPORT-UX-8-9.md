# REPORT: клиентский PWA, 5/10 → 8/10

**Самооценка UX: 8/10.** Не 9: не проверено на реальных устройствах — нет прогона на iOS Safari/Android, нет проверки QR боевым сканером кассы, нет аудита VoiceOver/TalkBack и замера скорости на слабом телефоне. Всё проверено в Chromium (Playwright) на 375×700.

**Тапов до QR при существующей карте: 0.** Новая карта: после онбординга QR появляется сразу (исправлена задержка до 60 с).

## Проверки
- `npx tsc --noEmit` в `frontend/` — чисто.
- `npx vitest run` в `frontend/` (`npm run test -w frontend`) — 10 тестов: склонения, фраза прогресса, копейки, статусы сети.
- `vite build` — успешно (PWA, 13 entries precache).
- Playwright на настоящем backend: QR 300 px; номер и «ещё N»/подарок над меню (в том числе в состоянии «подарок»); install-баннер на главной не fixed; офлайн-перезагрузка production-сборки показывает QR.
- Backend-тесты не запускались: backend не менялся.

## Файлы (frontend/)
Новые: `src/lib/{plural,syncStatus,wakeLock,installStore,card,ui.test}.ts`, `src/pages/StoresPage.tsx`.
Изменены: `src/pages/{CardPage,CardQrPage,ProfilePage,HistoryPage,MorePage,MenuPage,PromosPage,InvitePage}.tsx`, `src/components/{InstallBanner,Qr}.tsx`, `src/{App,main}.tsx`, `src/lib/{ensureGuest.ts,icons.tsx}`, `src/styles.css`, `index.html`, `package.json` (vitest). Документация: `docs/PWA-UX-8-9.md`; прежний отчёт — `REPORT-PREVIOUS.md`.

## Регрессии (не сломано)
QR-first; кружки + «Ещё N»; гость без телефона/SMS; QR карты = `best.token` (signed proof), invite — отдельный URL; расчёты на сервере; история policy B; 3 вкладки; нет списания кэшбэка в PWA; бренд #002FA7.

## Не сделано / ограничения
- Реальные устройства, QR-сканер кассы, VoiceOver/TalkBack.
- Яркость экрана из браузера не поднять; используется только Wake Lock.
- Typecheck шёл против backend-типов из рабочей копии админ-редизайна (общий `node_modules`); клиентские маршруты те же.
