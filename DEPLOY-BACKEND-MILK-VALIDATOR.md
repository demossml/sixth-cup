# DEPLOY-BACKEND-MILK-VALIDATOR

Источник: `sixth-cup-milk-validator-READY.zip` (снимок `sixth-cup-main`), ветка `main`.

## 1. Коммит

| | |
|---|---|
| HEAD до | `2283d0a` |
| **commit SHA** | **`66a760f51902fa8fad198549dfef5209a85496da`** (`66a760f`) |
| Сообщение | `fix(milk): receipt validator companion — label warnings + audit` |
| Push | `2283d0a..66a760f  HEAD -> main` — OK |
| Рабочее дерево | чисто |

## 2. Что вошло (8 файлов)

| Файл | Изменение |
|---|---|
| `backend/src/modules/catalog/milkScheme.ts` | `milkLabelMatches`, `milkLabelWarnings` (+ нормализация: нижний регистр, «ё»→«е», стоп-слова «молоко/молочко/milk», основы 4 буквы) |
| `backend/src/modules/admin/routes.ts` | `POST /api/admin/milk-schemes` → `{ scheme, warnings }`; новый `GET /api/admin/milk-schemes/audit` |
| `backend/src/__tests__/milk-scheme.test.ts` | +3 теста: «свой товар — без предупреждений», «Кокосовое ↔ овсяное = 1 warning + audit», «формат `/configuration` не изменился» |
| `frontend-admin/src/lib/milkScheme.ts` | `milkLabelMatches`, `milkDraftWarnings` (зеркало серверных правил) |
| `frontend-admin/src/lib/milkScheme.test.ts` | +4 теста |
| `frontend-admin/src/pages/MilkSchemes.tsx` | предупреждения в карточке схемы, **сохранение не блокируется** |
| `docs/MILK-OPTION-IDS.md` | новый: id молока = `milk_scheme_variants.id`, audit/warnings, SQL проверки |
| `docs/IMPLEMENTATION-MILK-VALIDATOR-REPORT.md` | отчёт по APK 158 / backend / admin |

Миграций нет, формат `GET /api/devices/products/:id/configuration` не менялся, БД не трогали
(никаких wipe и `UPDATE product_id`).

### Отклонение от архива (одно, сознательное)

В архивном `MilkSchemes.tsx` строка `const draftWarn = edit ? milkDraftWarnings(edit, nameOf) : []`
попала **дважды**, второй раз — внутри JSX (`<div className="space-y-3">`), что ломает сборку
(повторное объявление + текст в разметке), а сам `draftWarn` нигде не рендерился.
Собран эквивалентный вариант: одно объявление на верхнем уровне + рендер списка предупреждений
(`text-warn`) рядом с блокирующей ошибкой `draftMsg`. Остальные 7 файлов перенесены
байт-в-байт.

## 3. Тесты

| Прогон | Результат |
|---|---|
| `backend: npx vitest run` (свежий `DB_PATH`) | **88 файлов / 584 теста — pass** |
| `frontend-admin: npx vitest run` | **10 файлов / 54 теста — pass** |
| `npm run typecheck` (root, 3 пакета: backend, frontend, frontend-admin) | OK |
| `npm run build` (root, turbo) | 3 задачи OK; admin и frontend собраны, PWA precache 35 entries |

Совпадает с заявленными в `IMPLEMENTATION-MILK-VALIDATOR-REPORT.md` цифрами (584 / 54).

## 4. Дополнительно проверено по коду

- `milkLabelWarnings` фильтрует только `active = 1 AND send_to_receipt = 1` — бесплатное молоко не шумит.
- `warnings` возвращаются и при создании, и при правке схемы (общий обработчик `POST`), но не блокируют сохранение.
- `GET /milk-schemes/audit` под тем же `requireAdmin`, что и остальные `milk-schemes` (права не расширены).

## 5. Готовность

**готово к pull на Mini: да.**

Порядок на Mini: `git pull` → `npm ci` (если менялся lock — не менялся) → `npm run build` →
рестарт `sixth-cup-api`. Миграций нет, рестарт без дополнительных шагов.

Осталось вне этого репозитория (как и указано в отчёте APK): собрать и установить APK
**158 / 5.2.32-milk-validator** в `evotor-app` (`./gradlew testDebugUnitTest assembleDebug`) —
backed-изменения совместимы со старым контрактом и не требуют новой кассы.
