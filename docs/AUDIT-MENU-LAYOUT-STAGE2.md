# Макет меню — этап 2 аудита: модель v2 и объёмы

Продолжение [AUDIT-MENU-LAYOUT-STAGE0-1.md](./AUDIT-MENU-LAYOUT-STAGE0-1.md). Сделаны **2.1 (схема v2)**,
**2.3 (объёмы и цены)**, **2.4 (лёгкий каталог)** и **2.5 (PDF с объёмами)**. Задача 2.2 (движок раскладки
секций) отложена до этапа 3 — см. «Чего нет» в конце.

Зона: `backend/` + `frontend-admin/`. PWA, касса, Cost, Evotor, лояльность не менялись.

## 2.1 — схема документа v2

`doc_json` получил `schemaVersion` и семантический слой **рядом** с блоками: блоки остаются языком рендера,
поэтому старые макеты и текущий PDF не ломаются.

```jsonc
{
  "schemaVersion": 2,
  "pages": [{
    "id": "page-1",
    "blocks": [ /* текущий холст: координаты, zIndex — как было */ ],
    "template": "two-column-photo",
    "sections": [{
      "id": "sec-1", "title": "Кофе", "categoryId": 4,
      "style": { "showPhotos": true },
      "items": [{
        "id": "it-1", "productId": 42, "groupId": null,
        "titleOverride": null, "description": null, "badge": "ХИТ",
        "showPhoto": true, "photoUrlOverride": null, "hidden": false,
        "sizes": [
          { "label": "250 мл", "source": "catalog", "productId": 42, "volumeItemId": 11, "priceRubOverride": null },
          { "label": "450 мл", "source": "manual",  "productId": null, "volumeItemId": null, "priceRubOverride": 289 }
        ]
      }]
    }]
  }]
}
```

- `sizes[].source`: `catalog` (цена из объёмов/группы, в `live` меняется вместе с каталогом) или `manual`
  (цена задана руками — помечается в интерфейсе как «не из каталога»).
- Фото позиции — только `/uploads/…` (правило 1.5 действует и на v2).
- Миграция 1→2 **без потерь**: `normalizeDoc` поднимает версию, только если в документе уже есть секции;
  иначе остаётся `schemaVersion: 1` и все блоки работают как раньше (блоки человека не теряются и не двигаются).
- `MenuBlock` получил `itemId` и `pinned` — для будущей раскладки: блоки с `pinned: true` движок не трогает.
- zod (`docZ`) принимает `schemaVersion`, `sections`, `template`, `itemId`, `pinned`, `snapshotSizes` —
  иначе PUT отбрасывал бы новые поля.

## 2.3 — объёмы и цены (ML-06)

Источник объёмов — существующий каталог, ничего не дублируем:

| Источник в каталоге | Что печатаем |
|---|---|
| `product_volume_prices` + `volume_scheme_items` | «250 мл · 350 мл · 450 мл» и «169 · 219 · 269» |
| `product_groups` + `variant_label` (варианты группы) | по размеру на вариант |
| одиночный товар | как раньше — одна цена |

- `loadVolumeSizes(productIds)` и `loadGroupSizes(groupIds)` в `menuLayoutDoc.ts` (по одному запросу на пачку,
  без N+1).
- `CatalogProduct.sizes` → `resolveDoc().displaySizes: { label, price }[]`.
- Ручная цена блока (`priceRubOverride` / `priceText`) сильнее объёмов — тогда печатается только она.
- **frozen**: при фиксации цен блок получает `snapshotSizes`; `frozen` печатает снимок, `live` — свежие цены.
  Проверено тестом: цену объёма в каталоге подняли 180 → 195, `frozen` остался 180/230.
- Клиент считает то же в `resolvePreview`, поэтому холст и PDF показывают одинаковые строки.

## 2.4 — лёгкий каталог для пикера (ML-10)

`GET /api/admin/menu-layouts/catalog` — один запрос вместо `/products` + `/categories`:
`{ products: [{ id, name, price, imageUrl, available, categoryId, categoryName, variantLabel, prices }], categories }`.
`prices` — готовые объёмы с подписями. Редактор макета переведён на этот эндпоинт (N+1 по объёмам убран).
Остальные разделы админки продолжают использовать `/products` — не трогали.

## 2.5 — PDF с объёмами

Позиция с 2+ объёмами печатается двумя строками: название, под ним «250 мл · 350 мл · 450 мл» слева
и «169 · 219 · 269» справа (как в макете на экране, `.mc-product-sizes`). Условие — высота блока > 14 pt,
иначе остаётся одна цена (чтобы текст не наезжал).

## Проверки

| Что | Результат |
|---|---|
| `npm run typecheck` | 3/3 |
| backend | **785** тестов / 110 файлов (+7: объёмы, v2, каталог, PDF) |
| `frontend-admin` | **111** тестов (+3: объёмы в превью) |
| `npm run build` | OK |
| Браузер + PDF | «Корица» с тремя объёмами: на холсте и в PDF одинаково «250 мл · 350 мл · 450 мл | 169 · 219 · 269» |

Гейт этапа 2 по объёмам закрыт: «капучино с тремя объёмами → одна позиция, три цены»; `live` обновляется,
`frozen` держит снимок.

## Чего нет (честно)

- ~~**2.2 — движок раскладки секций**~~ — сделан отдельным шагом, см.
  [AUDIT-MENU-LAYOUT-STAGE3.md](./AUDIT-MENU-LAYOUT-STAGE3.md).
- Шаблоны (библиотека из 6), AI-помощник — этапы 3–5.
- `menu_layout_versions`, `menu_assets` — таблицы истории и ассетов не заводились (ML-09 остаётся).
