# ADMIN_FIXES_REPORT

Основа: `sixth-cup-main_11.zip`. Исправлены подтверждённые находки из `ADMIN_AUDIT_REPORT.md` одним архивом (по вашей просьбе, вместо поэтапных). Ответов на «вопросы владельцу» (раздел 7 аудита) не было — приняты консервативные значения, они перечислены ниже и легко меняются.

| ID | Изменённые файлы | Причина | Исправление | Проверка |
|---|---|---|---|---|
| A-01 | `frontend-admin/src/api/client.ts` | Ошибки zod показывались как «[object Object]» | `errorText()` разбирает `error.issues`; контракт сервера не менялся | тест `errorText`; в браузере: калории 2.5 → «Проверьте данные — calories: Expected integer, received float» |
| A-02 | `backend/src/modules/admin/console.ts`, `audit.ts` | Показ телефона не попадал в журнал; viewer видел телефон | viewer → 403; GET `/customers/:id/phone` сам пишет строку аудита; в `actor` пишется роль | тесты: viewer 403, +1 строка аудита с `actor=manager` |
| A-03 | `backend/src/modules/admin/routes.ts` | Manager мог создавать точки/кассы, менять ИИ-настройки, выдавать ваучеры всем | `MANAGER_BLOCKED` (anchored regex): `/stores`, `/devices`, `/ai/settings`, `/vouchers/grant-all`, reset/wipe/organizations; коды привязки касс в `GET /devices` видит только owner | тесты на 403 и на то, что контент (`/products`, `/evotor/stores/…/push-products`, промо) остался доступен |
| A-04 | `frontend-admin/src/lib/format.ts`, `pages/Customers.tsx`, `pages/CustomerCard.tsx` | Суммы без копеек и с копейками не выравнивались по запятой | `fmtKopFixed` (всегда 2 знака) + `tabular-nums` в колонке «Кэшбэк» и списке начислений | тест; скриншот «до/после» 1280 px |
| A-05 | `backend/src/modules/upload/routes.ts`, `frontend-admin/src/api/client.ts`, `pages/MenuProducts.tsx`, `pages/Marketing.tsx` | Manager не мог загружать фото; ошибка — сырой JSON | upload пускает owner и manager (viewer — 403 «Read-only»); единый `uploadFile()` с разбором ошибок и обработкой 401/403 | тесты: manager 200, viewer 403 |
| A-08 (часть) | `upload/routes.ts` | MIME видео доверялся клиенту; тело читалось без лимита | проверка сигнатуры MP4 (`ftyp`) / WebM (EBML); `bodyLimit` 20 МБ + 64 КБ (413) | тесты: поддельный mp4 → 400 |
| A-09 | `frontend-admin/src/ui/kit.tsx` | Подписи не привязаны к полям; строки таблиц недоступны с клавиатуры; нет фокус-ловушки; эффект Drawer зависел от `onClose` | `Field` связывает `label` с единственным контролом (иначе `role=group aria-labelledby`); строки таблиц `tabIndex`+Enter/Space; `aria-sort`; Drawer: ловушка Tab, актуальный `onClose` через ref; Tabs: стрелки | браузер: Enter на строке открывает карточку; клик по подписи фокусирует поле; после 60 Tab фокус остаётся в окне; Esc закрывает |
| A-10 | `ui/kit.tsx` | На телефоне цена смещена относительно подписи; заголовок «В ПРОДАЖЕ» переносился | `items-center` у сетки карточки, `whitespace-nowrap` у заголовков | скриншоты 390/1280 |
| A-11 | `frontend-admin/src/App.tsx` | Все страницы в одном чанке 324 кБ | `React.lazy` + `Suspense` для всех страниц (включая `/legacy`) | вход 323,7 → **206,4 кБ** (gzip 99,5 → **66,5**); все 13 экранов открываются |
| A-12 | `routes.ts` (POST `/products`), `pages/MenuProducts.tsx` | Форма затирала правки с другого устройства | необязательный `expectedUpdatedAt` → 409; форма его отправляет; старые клиенты без поля работают как раньше | тест 409 / 200 / без поля |
| A-13 | `routes.ts` | `grant-all` с неизвестным кодом → 500 | 404 «Шаблон ваучера не найден», запись в аудит с числом получателей | тест |
| A-14 | `audit.ts` | `actor` всегда `admin` | пишется роль (owner/manager/viewer) | тест |
| A-15 | `routes.ts` | Схема добавок обновлялась без транзакции; неизвестный id создавал сироты | транзакция + 404 | тест |
| A-16 | `layout/Shell.tsx` | Одна иконка у 4 разделов | разные иконки (Share2, BarChart3, CalendarClock, Bot) | визуально |
| A-07 (часть) | `frontend-admin/index.html` | Нет noindex | `<meta name="robots" content="noindex, nofollow, noarchive">` | файл |
| A-20 | `routes.ts` | `DELETE/revoke` несуществующей кассы → 200 | 404 | тест |

## Результаты проверок после изменений

| Проверка | До | После |
|---|---|---|
| `tsc --noEmit` frontend-admin | OK | OK |
| `vite build` frontend-admin | OK, 1 чанк 323,7 кБ | OK, входной чанк 206,4 кБ, страницы 1,6–32 кБ |
| `tsc --noEmit` backend | OK | OK |
| `vitest run` backend | 22 файла / 103 теста | 23 файла / **116 тестов** (+13 новых), все зелёные |
| Браузер (Playwright, Chromium): клавиатура, label, фокус, Esc, текст ошибки валидации | — | пройдено (см. выше) |
| Визуально 1280 / 390 px: Клиенты, Меню | дефекты | исправлены |

## Не исправлено (и почему)

- **A-06** (rate limit по `X-Forwarded-For`), **A-07** (security-заголовки, CORS `*`, `nosniff` на `/uploads`, `/robots.txt`), **A-08** (Range-запросы читают файл целиком) — требуют правки общего `backend/src/app.ts`/`config.ts`, которые обслуживают и клиентский PWA. Без вашего согласования не трогал. Рекомендация для деплоя: порт 3000 слушать только на 127.0.0.1 (за Caddy заголовок XFF перезаписывается).
- **A-17** (страница «Старая версия»): оставлена, теперь грузится лениво; решение об удалении за вами.
- **A-18, A-19** (P3: запасные `try/catch` в промо, проверка URL промо, перенос лога на мобильном): не затрагивают корректность, оставлены.
- Реальный Evotor Cloud, production-данные, медленная сеть, экранная клавиатура, zoom 200 % — не проверялись.

## Принятые допущения (из вопросов владельцу)

1. Manager = только контент и аналитика (меню, фото, акции, ИИ-черновики, выгрузка товаров на кассу). Если нужно больше — отредактируйте `MANAGER_BLOCKED` в `backend/src/modules/admin/routes.ts`.
2. Телефон клиента: owner и manager — да (с записью в журнал), viewer — нет.
3. «Старая версия» — оставлена, ленивая загрузка.
4. Общий `app.ts` не менялся.

## Оставшиеся риски

Роли определяются тремя статическими токенами (нет сессий и отзыва по пользователю); токен хранится в `localStorage` (XSS-риск); при прямом доступе к порту backend без прокси лимит попыток обходится ротацией `X-Forwarded-For`.
