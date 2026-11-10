# Макет меню — конструктор холста (v1)

Раздел админки **«Макет меню»** (`/menu-layouts`) собирает лист для гостя или типографии из реального
каталога 6.7 и отдаёт **векторный PDF**. Это не каталог «Меню» (`/menu`) и не меню кассы: правки в макете
не меняют товары, кассу, PWA и Эвотор.

Документ заменяет [IMPLEMENTATION-MENU-LAYOUT-10.md](./IMPLEMENTATION-MENU-LAYOUT-10.md) (помечен deprecated).

## Было → стало

| | Было (flow, v0) | Стало (canvas, v1) |
|---|---|---|
| Раскладка | `flowPage`: колонки, категория → позиции потоком | каждый блок в своей рамке `xPct / yPct / wPct / hPct` |
| Движение | перестановка ↑↓ внутри потока | перетаскивание блока по листу, независимо от остальных |
| Размер | один на все позиции | у каждого блока свой, тянется ручкой SE или полями в панели |
| Порядок | порядок в массиве | `zIndex` + список слоёв («на передний / на задний») |
| Контент | product / category / header / hero / note / qr | product / category / text / image / logo / divider |
| Фото | только из каталога | каталог **или** своё (upload / URL) |
| Фон листа | цвет | цвет **или** картинка + затемнение |
| PDF | рисовал поток заново | рисует **ту же** координатную сцену |

Проценты считаются от **безопасной области** листа: поля 4,4 % ширины по бокам и сверху, 6 % снизу
(там же подвал с названием и номером страницы). Правило задано один раз —
`backend/src/modules/admin/sheetGeometry.ts` и его зеркало `frontend-admin/src/lib/sheetGeometry.ts`:
холст ставит блоки внутрь `.mc-safe` (отступы в `cqw`), PDF считает те же поля через `contentBox`.
Так превью и печать совпадают без пересчёта; подробности и тесты — в
[AUDIT-MENU-LAYOUT-STAGE0-1.md](./AUDIT-MENU-LAYOUT-STAGE0-1.md).

## Схема документа (`doc_json`)

```jsonc
{
  "pages": [
    {
      "id": "page-1",
      "blocks": [
        {
          "id": "p-42-ab12c",
          "type": "product",        // product | category | text | image | logo | divider
          "xPct": 0, "yPct": 22, "wPct": 44, "hPct": 4.4,
          "zIndex": 3,
          "rotationDeg": 0,          // опционально, по умолчанию 0
          "hidden": false,
          "productId": 42,           // для type=product
          "categoryId": 4,           // для type=category
          "titleOverride": null,
          "priceRubOverride": null,  // null = цена из каталога/снапшота
          "priceText": null,         // «169 / 269» — как есть, текстом
          "showPhoto": true,
          "photoUrlOverride": null,  // своё фото позиции
          "badge": null,             // NEW | ХИТ | VEGAN | …
          "text": null,              // для text / подпись у logo
          "url": null,               // для image
          "fit": "cover",            // cover | contain
          "fontSizePt": 10, "align": "left", "bold": false,
          "snapshotPriceRub": 169,   // снапшот для frozen и для баннера расхождений
          "snapshotName": "Капучино",
          "snapshotImageUrl": "/uploads/…",
          "sortOrder": 3
        }
      ]
    }
  ]
}
```

Инварианты:

- минимум рамки — `6 × 2 %` (`MIN_W` / `MIN_H`), блок не выходит за лист (`clampRect`);
- `hidden: true` — блок не попадает в рендер и PDF, но **не удаляет** товар каталога;
- `productId` — единственная связь с каталогом; всё остальное в блоке — это макет;
- серверные поля (`displayName`, `displayPrice`, `displayImageUrl`, `catalogPriceRub`, `warnings`) в `doc_json`
  не сохраняются: они считаются при чтении и в PUT отбрасываются (`docPayload` на клиенте, zod на сервере).

### Миграция старых макетов

`migrateDocToCanvas(doc)` выполняется **при чтении** (`GET /menu-layouts/:id`, список, PUT, PDF):

- блок без конечных `xPct/yPct` считается старым и раскладывается в сетку: 2 колонки по 44 %, шаг строки 6.2 %,
  заголовки категорий и позиции идут по порядку `sortOrder`; ничего не «обнуляется» и не теряется;
- `header → logo` (`text` из подписи), `hero → text` (`fontSizePt: 34`), `note/qr → text`, `photo → image`;
- функция идемпотентна: у блоков с координатами ничего не двигается (проверено тестами).

## API (`/api/admin`, авторизация как у остальных admin-роутов)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/menu-layouts` | список + превью первых блоков и темы (для миниатюр) |
| POST | `/menu-layouts` | `{ title, format? }` → лист с логотипом и заголовком (уже в координатах) |
| GET | `/menu-layouts/:id` | макет + резолв каталога, `warnings`, `blockers`, `drift`, `stats` |
| PUT | `/menu-layouts/:id` | `{ title?, theme?, doc?, status?, priceMode? }` — документ нормализуется и мигрируется |
| DELETE | `/menu-layouts/:id` | удалить макет (товары каталога не трогаются) |
| POST | `/menu-layouts/:id/duplicate` | копия листа |
| POST | `/menu-layouts/:id/sync-prices` | live — обновить снапшоты цен из каталога; frozen — вернуть `changed[]` без правок |
| POST | `/menu-layouts/:id/seed-from-catalog` | разложить доступные категории и позиции **по координатам** (2 колонки) |
| GET | `/menu-layouts/:id/export.pdf` | `?preset=print\|screen&bleed=мм&force=1` → PDF файлом |

Форматы: `a4_portrait` (по умолчанию), `a4_landscape`, `a3_portrait`, `ratio_1_1`, `screen_16_9`.

Резолв при чтении (`resolveDoc`): название, цена, фото и доступность позиции берутся из каталога для `live`
и из снапшота для `frozen`; `priceRubOverride` и `photoUrlOverride` сильнее каталога.
Объёмы позиции (`displaySizes`) приходят из `product_volume_prices` или вариантов группы: «250 мл · 350 мл · 450 мл»
и цены под ними — одинаково на холсте и в PDF. Подробности — [AUDIT-MENU-LAYOUT-STAGE2.md](./AUDIT-MENU-LAYOUT-STAGE2.md).
Замечания блока: `позиции больше нет в каталоге`, `скрыта в каталоге`, `нет цены`, `нет фото`, `нет картинки`,
`категория не найдена`.

## Редактор

- **Десктоп (≥ 1024 px):** каталог/слои слева, лист в центре (зум, сетка, безопасная область, страницы),
  оформление и свойства блока справа.
- **Телефон (< 1024 px):** вкладки «Превью / Состав / Дизайн / PDF»; блок выбирается тапом по листу,
  координаты и размер правятся полями X / Y / ширина / высота.
- **Drag & resize** — pointer events на `position: absolute` блоках; без Fabric/Konva.
  Перетаскивание поднимает блок на передний план (то же, что видно в PDF); «на задний» — кнопкой в слоях.
- **Клавиатура:** стрелки двигают блок на 0,5 % (Shift — 5 %), `Delete` убирает блок с листа
  (Alt+Delete — скрыть), `⌘Z` / `⌘⇧Z` — отмена и возврат.
- **Undo/redo** — 100 шагов, один шаг на жест, `⌘Z` / `⌘⇧Z` (локально, без сервера).
- **Автосохранение** — PUT с debounce 800 мс + `flush` на `pagehide`; `baseRev` защищает от затирания
  правок второго окна (409 `rev_conflict` → выбор «взять серверную» / «перезаписать своей»).
- **Своё фото** — загрузка в общий media-upload админки или ссылка `/uploads/…`; для `image`-блока ещё
  вписывание `cover` / `contain`.

## PDF

`backend/src/modules/admin/menuLayoutPdf.ts`, PDFKit, вариант **A** (векторный текст, без headless-браузера):

- страница = формат из макета; блок рисуется в `pad + x% * cbW` — та же геометрия, что в редакторе;
- поля: `pad = 26 pt * scale + bleed`, `bleed` по умолчанию 3 мм для print и 0 для screen;
- метки реза рисуются только в `preset=print` при `bleed > 0`;
- текст — векторный, шрифты встроены сабсетами (`GolosText 400/600`, `Unbounded 400/600`), есть `ToUnicode`;
- картинки встраиваются буфером: JPEG/PNG как есть, остальные форматы (webp из админки) конвертируются
  в PNG через `sharp` — иначе PDFKit их не принимает;
- фон листа — цвет или картинка с затемнением (`backgroundDim`, 0…100);
- если есть «жёсткие» замечания — `409 has_blockers` со списком; `force=1` скачивает как есть;
- имя файла `menu-{id}-{YYYY-MM-DD}.pdf`, `Content-Type: application/pdf`, `Cache-Control: no-store`;
- CMYK, спуск полос и presets типографии не поддерживаются.

## Ограничения v1

- холст **не** Figma: нет свободных направляющих, привязок, группировки и булевых фигур;
- `rotationDeg` поддержан в данных и PDF, в UI — нет поля поворота;
- на телефоне блок двигается пальцем, но ручка resize доступна только на десктопе (на телефоне — поля X/Y/W/H);
- одна колонка страниц и один слой на блок (без групп слоёв);
- публикация макета в PWA «живым меню» не делается — только PDF.

## Файлы

| Слой | Файл |
|---|---|
| Модель, нормализация, миграция, резолв | `backend/src/modules/admin/menuLayoutDoc.ts` |
| PDF по координатам | `backend/src/modules/admin/menuLayoutPdf.ts` |
| API `/menu-layouts` | `backend/src/modules/admin/menuLayouts.ts` |
| Тесты API и миграции | `backend/src/__tests__/menu-layouts.test.ts` |
| Клиентская модель и геометрия | `frontend-admin/src/lib/menuLayout.ts` |
| Холст (рендер блоков) | `frontend-admin/src/components/menuLayout/MenuCanvas.tsx` |
| Редактор | `frontend-admin/src/pages/MenuLayoutEditor.tsx` |
| Список макетов | `frontend-admin/src/pages/MenuLayouts.tsx` |
| Стили `.mc-*` и карточек | `frontend-admin/src/styles/menuLayout.css` |

## Проверка

```bash
cd backend && DB_PATH=$(mktemp -u /tmp/ml-XXXX.db) npx vitest run src/__tests__/menu-layouts.test.ts
npm run test -w frontend-admin     # геометрия холста, слои, резолв, баннеры цен
npm run typecheck && npm run build
```

Тесты покрывают: сохранение координат (PUT → GET), детерминированную миграцию flow → canvas, порядок по
`zIndex`, live/frozen цены, `sync-prices`, `seed-from-catalog`, 409 и `force=1`, многостраничность,
встраивание webp-картинки и отсутствие регресса каталога при скрытии блока.
