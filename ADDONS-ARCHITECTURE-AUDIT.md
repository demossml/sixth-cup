# ADDONS ARCHITECTURE AUDIT — подсистема добавок

Этап B мастер-задания. Коммит-срез: `e32ba2f`. Всё ниже — по фактическому коду; предположения помечены.

---

## 1. Главный вывод по OID

**OID в приложении не смоделирован вообще.** Проверено поиском по всему backend: единственные совпадения `oid` — локальная переменная в `admin/studio.ts` (id партии), не имеющая отношения к Эвотору.

Интеграция построена на **UUID**:

| Идентификатор | Где живёт | Назначение |
|---|---|---|
| `products.id` | `products` | локальный PK, internal |
| `products.is_group` | `products` | 1 = папка каталога |
| `products.parent_product_id` | `products` | локальная ссылка на группу; в Эвотор уходит как `parentUuid` |
| `product_store_links.evotor_uuid` | `product_store_links` | UUID товара **для конкретной точки**, PK `(product_id, store_uuid)` |
| `evotor_products.evotor_uuid` | `evotor_products` | состояние синхронизации, PK `(product_id, variant, store_uuid)` |
| `modifiers.id` / `linked_product_id` | `modifiers` | справочник добавок ↔ реальный товар |
| `modifier_scheme_options.product_id` | `modifier_scheme_options` | опция схемы → конкретный товар |
| `modifier_scheme_options.modifier_id` | `modifier_scheme_options` | legacy-опция → запись справочника |
| `product_groups.id`, `products.variant_label` | `product_groups`, `products` | варианты объёма |

Практический вывод для задачи «почему OID не участвует в таблице добавок»: **он и не должен** в текущей архитектуре. Cloud API, которым пользуется приложение, адресует товары UUID; parent-связь передаётся как `parentUuid`, полученный из `product_store_links`. Добавлять колонку `oid` «для похожести на Эвотор» не нужно — это была бы мёртвая колонка без источника значения.

Если OID всё же понадобится (например, для старого API касс), правильное место — отдельная таблица соответствий `product_store_links(store_uuid, product_id) → external_id` с типом идентификатора, а не колонка в `products`.

---

## 2. Модель данных (фактическая)

```
categories (id, name)                  ← «Добавки» — служебная
   └── products (id, name, price, category_id,
                 is_group, parent_product_id,
                 counts_as_cup, free_eligible, modifier_scheme_id)
          ├── product_store_links (product_id, store_uuid) → evotor_uuid
          ├── evotor_products     (product_id, variant, store_uuid) → evotor_uuid
          ├── modifier_scheme_options.product_id
          └── product_groups / variant_label  ← варианты объёма

modifiers (id, name, price, group_key, available, linked_product_id)
   ├── modifier_scheme_items   (scheme_id, modifier_id)          ← v1
   └── modifier_scheme_options (scheme_id, kind, modifier_id)    ← v2

modifier_schemes (id, name)
   └── modifier_scheme_options (kind ∈ product|zero|modifier,
                                is_default, required, max_count, group_key)
```

Инварианты, заложенные в схеме:

- `UNIQUE(scheme_id, group_key) WHERE is_default=1` — не более одного дефолта на группу;
- `modifier_scheme_options.product_id … ON DELETE SET NULL` — удаление товара не рушит схему;
- `modifier_scheme_options.modifier_id … ON DELETE CASCADE`;
- `product_store_links.product_id … ON DELETE CASCADE`;
- `modifiers.linked_product_id` — **NO ACTION** (см. A2).

---

## 3. Найденные проблемы

### A1. Привязка добавки к товару по имени (P1, целостность данных)

`modules/catalog/addonScheme.ts` → `syncModifierProduct()`.
Если `linked_product_id` пуст, товар ищется по нормализованному имени среди `is_group=0`, с приоритетом «уже в Добавках», затем **любой не-чашечный товар**. Найденный товар принудительно переводится в «Добавки» и получает `counts_as_cup=0`.

Последствия:
- розничный товар с тем же названием (например «Корица» в «Другое») будет изъят из меню клиента и превращён в добавку;
- два разных SKU с одинаковым названием сливаются — ровно то, что ТЗ запрещает.

Именно это расхождение (id vs имя) ТЗ и просит исключить. Ограничение «не трогаем напитки» (`counts_as_cup=1`) снижает риск, но не устраняет его для розницы.

Статус: не исправлено, требует решения по продуктовой семантике (автоматический перенос vs явное подтверждение).

### A2. Нет уникальности `linked_product_id` (P2)

Индекс `idx_mod_linked_product` не уникален: две добавки могут ссылаться на один товар. `syncModifierProduct` в этом случае перезапишет цену/доступность товара значением последней добавки.

### A3. Схема размазана по трём источникам (P2, поддерживаемость)

`db/schema.ts` (базовые таблицы), `integrations/evotor/db.ts` (evotor_*, loyalty_ledger, часть ALTER), `db/migrations/*.sql` (27 файлов). Наличие колонки зависит от порядка инициализации — это уже привело к дефекту D4 (`sync_enabled`). Единого владельца схемы нет.

### A4. `EVOTOR_CATALOG_ALIGN`/миграции правят данные (P2)

Миграция 027 не только создаёт структуру, но и **меняет данные**: создаёт товары-прокси для добавок, переносит категории, проставляет `linked_product_id`. Такие миграции труднее откатывать; при этом именно её guard оказался нерабочим для кириллицы (дефект D2).

### A5. Дубли категорий-добавок (исправлено в `e32ba2f`)

Оставалось несоответствие: касса (`devices/addons.ts`) уже корректно собирала **все** категории-добавки и сравнивала имена в JS, а публичное меню (`directory/routes.ts`) фильтровало только первую. Исправлено: обе стороны используют общий набор id; добавлен `dedupeCategoriesByName()` при bootstrap.

---

## 4. Оценка целевой архитектуры

| Требование ТЗ | Фактически | Вывод |
|---|---|---|
| одна сущность добавки | `modifiers` + `products` (связаны) | допустимо, связь обязательна |
| внешние id в правильном месте | `product_store_links` | соответствует |
| parent-группа по данным каталога | `parent_product_id` → `parentUuid` | соответствует |
| схема по id, не по имени | хранение по id ✅, **создание связи по имени** ⚠️ | A1 |
| своя точка — свои id | PK `(product_id, store_uuid)` | соответствует |
| объёмы отдельно | `product_groups` | соответствует |
| группы ≠ товары | `is_group` | соответствует |
| идемпотентность | `linked_product_id` переиспользуется | частично, A1 |
| касса получает только валидные опции | требует проверки `available`/`required` | ❌ не проверено |

Перестраивать модель не требуется: она уже близка к целевой. Требуются точечные исправления (A1, A2) и проверка валидации на backend.

---

## 5. Что не проверено в этом проходе

Честно перечисляю, чтобы не выдавать пробелы за результат:

- формирование фискальных позиций в чеке (`processing/SellHandler.ts`) и поведение при отсутствии `evotor_uuid`;
- соблюдение `required` / `max_count` на backend, а не только в UI;
- поведение при удалении/деактивации добавки и устаревшем кеше каталога;
- конкурентная выгрузка (`ProductPushService`) и частичные отказы;
- legacy-совместимость `#opt=`;
- производительность каталога на большом числе товаров.
