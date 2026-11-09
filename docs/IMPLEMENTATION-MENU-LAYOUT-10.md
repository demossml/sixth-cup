> **DEPRECATED / УСТАРЕЛО.** Документ описывает первую версию раздела с **потоковой** вёрсткой
> (категория → позиции в колонках, `flowPage`). Эта раскладка заменена на **холст с независимыми
> координатами** (drag/resize). Актуальная документация — [IMPLEMENTATION-MENU-LAYOUT-CANVAS.md](./IMPLEMENTATION-MENU-LAYOUT-CANVAS.md).
> Оценка «10/10» ниже относилась к потоковой модели и **не является критерием приёмки** текущей версии.

# Макет меню — реализация (10/10)

Раздел админки **«Макет меню»** (`/menu-layouts`) собирает лист для гостя или типографии
из **реального каталога** 6.7 и отдаёт **векторный PDF**. Это не каталог «Меню» и не меню кассы:
правки в макете не меняют товары, кассу, PWA и Эвотор.

Дизайн взят из прототипа `index (5).zip` (`menu.html` / `menu-spec.html`): список макетов с превью-миниатюрами,
редактор из трёх зон на десктопе и четырёх вкладок на телефоне, темы, орнаменты, режим цен, модалка экспорта.

## Что умеет

| Блок | Где |
|---|---|
| Список макетов с миниатюрой листа, статусом, счётчиком замечаний | `frontend-admin/src/pages/MenuLayouts.tsx` |
| Создание (A4 / A4 альбом / A3 / 1:1 / экран), дублирование, удаление | там же |
| Редактор: каталог, слои, холст A4, оформление, свойства слоя | `pages/MenuLayoutEditor.tsx` |
| Автосохранение (debounce 800 мс), статус «Сохранено/Есть изменения/Не сохранено» | там же |
| Undo (10 шагов), Delete скрывает блок, ↑↓ в слоях | там же |
| Сборка листа из каталога одной кнопкой | `POST /menu-layouts/:id/seed-from-catalog` |
| Цены: живые (из каталога) и зафиксированные (снапшот, дата фиксации) | `price_mode` + `frozen_at` |
| Баннер «в каталоге изменились цены» + «Обновить с каталога» | `POST /menu-layouts/:id/sync-prices` |
| Экспорт PDF: печать (поля 3 мм, метки реза) и экран | `GET /menu-layouts/:id/export.pdf` |
| Предупреждения: нет цены, позиция удалена, скрыта в каталоге, нет фото | блок `warnings` в ответе API |

## API (`/api/admin`, авторизация как у остальных admin-роутов)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/menu-layouts` | список + превью первых блоков и темы (для миниатюр) |
| POST | `/menu-layouts` | `{ title, format? }` → новый макет с шапкой и hero |
| GET | `/menu-layouts/:id` | макет с уже подставленным каталогом (`displayName`, `displayPrice`, `warnings`) |
| PUT | `/menu-layouts/:id` | `{ title?, theme?, doc?, status?, priceMode?, format? }` |
| DELETE | `/menu-layouts/:id` | удалить макет (товары каталога не трогаются) |
| POST | `/menu-layouts/:id/duplicate` | копия «… — копия» |
| POST | `/menu-layouts/:id/sync-prices` | обновить снапшот цен; в `frozen` только отчёт, без перезаписи |
| POST | `/menu-layouts/:id/seed-from-catalog` | `{ pageId?, replace?, categoryIds? }` — категории и доступные позиции |
| GET | `/menu-layouts/:id/export.pdf` | `?preset=print\|screen&bleed=3&force=1` → `application/pdf` |

Ошибки экспорта: `409 { error: "has_blockers", blockers: [...] }` — если есть позиции без цены
или удалённые из каталога. UI показывает список и кнопку «Всё равно скачать» (`force=1`).
Пустое название макета отклоняется (`400`), в UI поле не даёт сохранить пустоту.

## doc_json

```json
{
  "pages": [
    {
      "id": "page-1",
      "blocks": [
        { "id": "b1", "type": "header", "text": "весна / лето 2026", "sortOrder": 0 },
        { "id": "b2", "type": "hero", "titleOverride": "Кофе и не только", "text": "МЕНЮ · ТВЕРСКАЯ, 18", "sortOrder": 1 },
        { "id": "b3", "type": "category", "categoryId": 10, "sortOrder": 2 },
        { "id": "b4", "type": "product", "productId": 42, "showPhoto": false,
          "titleOverride": null, "priceText": null, "priceRubOverride": null,
          "snapshotPriceRub": 169, "snapshotName": "Капучино", "badge": null, "hidden": false, "sortOrder": 3 }
      ]
    }
  ]
}
```

Типы блоков: `header`, `hero`, `category`, `product`, `text`, `note`, `photo`, `divider`, `qr`.

Правила:

1. `sortOrder` — единственный порядок; сервер нормализует и сортирует.
2. `hidden` скрывает блок **в макете**; товар и позиция в БД остаются.
3. Приоритет текста/цены: `titleOverride` / `priceText` → `priceRubOverride` → каталог (live)
   или снапшот (frozen). Это позволяет напечатать «169 / 269» и не выдумывать второй объём.
4. `snapshotPriceRub` / `snapshotName` / `snapshotImageUrl` — последняя известная цена и данные
   каталога: нужны для режима `frozen` и для баннера расхождения.

### theme_json

`{ preset: classic|dark|season, bg, text, accent, fontHeading, fontBody, headingSize, itemSize,
columns: 1|2|3, ornament: none|line|beans|leaf, density: air|normal|dense, logoPosition: left|top-right|footer }`.
Невалидные значения нормализуются на сервере (цвет только `#RRGGBB`, кегли в допустимых диапазонах).

## Как устроен PDF

`backend/src/modules/admin/menuLayoutPdf.ts` — PDFKit, **текст векторный** (шрифты встроены,
есть `ToUnicode` и `FontFile2`, поэтому файл не «фото страницы»).

- шрифты: `backend/assets/fonts/GolosText-400/600.ttf`, `Unbounded-400/600.ttf` (кириллица + латиница + ₽);
- пресет `print`: поля под обрез (`bleed` 0–10 мм) и метки реза по углам; `screen`: без полей и меток;
- многостраничность: каждая страница `doc_json` — отдельная страница PDF;
- фото встраиваются только из `/uploads/*` (локальные файлы); внешние URL пропускаются осознанно;
- блоки после категорий прижаты к низу листа, строки распределяются по свободной высоте;
- имя файла: `menu-{id}-{YYYY-MM-DD}.pdf`.

Раскладка (колонки, разбиение категорий) считается **одинаково** на клиенте и на сервере —
`flowPage` в `frontend-admin/src/lib/menuLayout.ts` и в `backend/src/modules/admin/menuLayoutDoc.ts`.
Если править одну — править обе, иначе превью и печать разойдутся.

## Ограничения v1

- форматы: A4 (портрет/альбом), A3, 1:1, экран 16:9. Свитки и произвольные размеры — нет;
- нет свободного перетаскивания (Figma-подобного), порядок задаётся списком слоёв;
- QR-блок — панель со ссылкой, а не сгенерированный QR-код (v2);
- нет CMYK-конверсии и спуска полос: PDF в RGB, цветоделение делает типография;
- «Сохранить версию» / история версий не делались: есть undo на 10 шагов в пределах сессии;
- синхронизация с кассой/`cashier/menu` и автопубликация в PWA — вне scope.

## Проверки

- `backend/src/__tests__/menu-layouts.test.ts` — CRUD, сохранение после перезагрузки, скрытие позиции
  не трогает каталог, override, drift, live/frozen, sync-prices, seed, PDF (`%PDF`, `ToUnicode`,
  multi-page, 409 + force), раскладка колонок, нормализация мусора.
- `frontend-admin/src/lib/menuLayout.test.ts` — та же раскладка на клиенте, операции с блоками,
  локальный резолв каталога, баннер цен, снимок для undo.

## Миграция

`057_menu_layouts.sql` (+ rollback `057_menu_layouts_rollback.sql`). Таблица `menu_layouts`,
индекс по `updated_at`. Аддитивная: старые БД просто получают новую пустую таблицу.
