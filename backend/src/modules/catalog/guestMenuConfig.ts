/**
 * Конфигурация товара для витрины гостя (PWA).
 *
 * Отличия от `buildProductConfiguration` (касса):
 *  • не зависит от `product_store_links`/UUID — гостю нужны цены и доступность, а не фискальные связи;
 *  • молоко отдаётся с доплатой (цена привязанного товара), а не только флагом «бесплатно»;
 *  • добавки сгруппированы по `group_key` с человеческими подписями;
 *  • объёмы: если товар — SKU группы, берём её членов; иначе схему объёмов; иначе один базовый объём.
 *
 * Источник данных — те же таблицы, что правятся в админке (`products`, `volume_schemes`,
 * `milk_schemes`, `modifier_schemes`, `choice_schemes`), поэтому «что в админке — то и в меню».
 */
import type Database from 'better-sqlite3'
import { buildCatalogToppings, effectiveSchemeId, type CatalogTopping } from './addonScheme'
import { choiceForProduct } from './choiceScheme'
import { volumesForProduct } from './volumeScheme'

/** Подписи групп добавок — те же, что в PWA (`frontend/src/lib/menuModel.ts`). */
const GROUP_LABEL: Record<string, string> = {
  milk: 'Молоко',
  syrup: 'Сиропы',
  sugar: 'Сахар',
  topping: 'Добавки',
  // 'extra' — исторический ключ «прочих добавок» в справочнике: гостю показываем «Добавки», а не машинный ключ.
  extra: 'Добавки',
  other: 'Другое',
}

/** Подпись группы: известный ключ → человеческий текст, иначе «Добавки» (не сырой ключ из БД). */
const groupLabel = (key: string): string => GROUP_LABEL[key] ?? (key && /^[a-z_-]+$/i.test(key) ? 'Добавки' : key)

export type GuestVolume = {
  /** `sku:<productId>` для SKU-группы, `vol:<itemId>` для схемы объёмов, `base` — базовая цена. */
  id: string
  label: string
  sizeValue: number | null
  sizeUnit: string | null
  priceRub: number
  available: boolean
  isDefault: boolean
  /** Реальный товар-объём: уходит в заказ как `volumeId`, чтобы касса нашла SKU. */
  skuProductId: number | null
}

export type GuestMilkOption = {
  id: number
  label: string
  /** Доплата, ₽ (0 — бесплатно). */
  priceRub: number
  isDefault: boolean
  available: boolean
}

export type GuestAddonOption = {
  id: number
  name: string
  priceRub: number
  maxCount: number
  required: boolean
  isDefault: boolean
  available: boolean
  /** «Без сиропа»: вариант «ничего не добавлять», а не добавка. */
  zeroOption: boolean
}

export type GuestAddonGroup = {
  key: string
  label: string
  /** Обязательно выбрать хотя бы одну опцию группы. */
  required: boolean
  options: GuestAddonOption[]
}

export type GuestChoice = {
  title: string
  options: { id: number; label: string; isDefault: boolean }[]
}

export type GuestMenuConfig = {
  ok: true
  productId: number
  name: string
  description: string | null
  imageUrl: string | null
  /** Медиа карточки: фото (`imageUrl`) или видео (`videoUrl`) с кадром-обложкой (`posterUrl`). */
  mediaType: 'image' | 'video'
  videoUrl: string | null
  posterUrl: string | null
  priceRub: number
  available: boolean
  calories: number | null
  proteinG: number | null
  fatG: number | null
  carbsG: number | null
  volumes: GuestVolume[]
  milk: { required: boolean; options: GuestMilkOption[] } | null
  choice: GuestChoice | null
  addons: GuestAddonGroup[] | null
}

type ProductRow = {
  id: number
  name: string
  price: number
  available: number
  description: string | null
  image_url: string | null
  media_type: string | null
  video_url: string | null
  poster_url: string | null
  calories: number | null
  protein_g: number | null
  fat_g: number | null
  carbs_g: number | null
  group_id: number | null
  variant_label: string | null
  variant_sort: number | null
  size_value: number | null
  size_unit: string | null
  milk_scheme_id: number | null
  choice_scheme_id: number | null
  volume_scheme_id: number | null
  modifier_scheme_id: number | null
}

const num = (v: unknown): number | null => (v == null ? null : Number(v))

/** Список объёмов: SKU группы → схема объёмов → базовая цена. */
function buildVolumes(db: Database.Database, p: ProductRow): GuestVolume[] {
  const skus = p.group_id != null
    ? (db
        .prepare(
          `SELECT id, name, price, available, variant_label, variant_sort, size_value, size_unit
             FROM products
            WHERE group_id=? AND COALESCE(is_group,0)=0
            ORDER BY COALESCE(variant_sort,0), id`,
        )
        .all(p.group_id) as Array<{
        id: number
        name: string
        price: number
        available: number
        variant_label: string | null
        variant_sort: number | null
        size_value: number | null
        size_unit: string | null
      }>)
    : []

  if (skus.length > 1) {
    return skus.map((s, i) => ({
      id: `sku:${s.id}`,
      label: s.variant_label || s.name,
      sizeValue: num(s.size_value),
      sizeUnit: s.size_unit ?? null,
      priceRub: Number(s.price) || 0,
      available: Number(s.available) !== 0,
      isDefault: i === 0,
      skuProductId: Number(s.id),
    }))
  }

  const schemeVolumes = volumesForProduct(db, p.volume_scheme_id, p.id, Number(p.price) || 0)
  if (schemeVolumes.length > 1) {
    return schemeVolumes.map((v, i) => ({
      id: `vol:${v.itemId}`,
      label: v.label,
      sizeValue: num(v.sizeValue),
      sizeUnit: v.sizeUnit ?? null,
      priceRub: v.price,
      available: Number(p.available) !== 0,
      isDefault: v.isDefault ?? i === 0,
      // Схема объёмов не создаёт SKU: в заказ уходит сам товар + подпись объёма,
      // точную цену всё равно ставит касса.
      skuProductId: Number(p.id),
    }))
  }

  return [
    {
      id: 'base',
      label: '',
      sizeValue: num(p.size_value),
      sizeUnit: p.size_unit ?? null,
      priceRub: Number(p.price) || 0,
      available: Number(p.available) !== 0,
      isDefault: true,
      skuProductId: Number(p.id),
    },
  ]
}

/** Молоко: варианты схемы + доплата из цены привязанного товара. */
function buildMilk(db: Database.Database, schemeId: number | null): { required: boolean; options: GuestMilkOption[] } | null {
  if (schemeId == null) return null
  const rows = db
    .prepare(
      `SELECT v.id, v.label, v.product_id AS productId, v.is_default AS isDefault, v.is_free AS isFree,
              v.active AS active, COALESCE(p.price, 0) AS productPrice, COALESCE(p.available, 1) AS productAvailable
         FROM milk_scheme_variants v
         JOIN milk_schemes s ON s.id = v.scheme_id
         LEFT JOIN products p ON p.id = v.product_id
        WHERE v.scheme_id=? AND s.active=1
        ORDER BY v.sort_order, v.id`,
    )
    .all(schemeId) as Array<{
    id: number
    label: string
    productId: number | null
    isDefault: number
    isFree: number
    active: number
    productPrice: number
    productAvailable: number
  }>
  const options = rows
    .filter((r) => r.active === 1)
    .map((r) => ({
      id: Number(r.id),
      label: r.label,
      priceRub: r.isFree === 1 ? 0 : Number(r.productPrice) || 0,
      isDefault: r.isDefault === 1,
      // Бесплатное молоко доступно всегда; платное — если привязанный товар в продаже.
      available: r.isFree === 1 ? true : r.productId == null ? true : Number(r.productAvailable) !== 0,
    }))
  if (!options.length) return null
  // Первый вариант — дефолт, если админка не отметила ни одного.
  if (!options.some((o) => o.isDefault)) options[0].isDefault = true
  return { required: true, options }
}

/** Добавки: плоский список каталога → группы по `group_key`. */
function buildAddons(db: Database.Database, schemeId: number | null): GuestAddonGroup[] | null {
  if (schemeId == null) return null
  const toppings: CatalogTopping[] = buildCatalogToppings(db, schemeId, new Map())
  const usable = toppings.filter((t) => (t.name || '').trim().length > 0)
  if (!usable.length) return null
  const byKey = new Map<string, GuestAddonOption[]>()
  for (const t of usable) {
    const key = t.groupKey || 'other'
    const list = byKey.get(key) ?? []
    list.push({
      id: Number(t.id),
      name: t.name,
      priceRub: Number(t.priceRub) || 0,
      maxCount: Math.max(1, Number(t.maxCount) || 1),
      required: !!t.required,
      isDefault: !!t.isDefault,
      // Гостю UUID не нужен: «нет связи с кассой» — проблема выгрузки, а не наличия.
      available: t.available !== false || t.notReadyReason === 'no_evotor_uuid',
      zeroOption: !!t.zeroOption,
    })
    byKey.set(key, list)
  }
  return [...byKey.entries()].map(([key, options]) => ({
    key,
    label: groupLabel(key),
    required: options.some((o) => o.required),
    options,
  }))
}

export function guestMenuConfig(db: Database.Database, productId: number): GuestMenuConfig | null {
  const p = db
    .prepare(
      `SELECT id, name, price, available, description, image_url,
              media_type, video_url, poster_url, calories, protein_g, fat_g, carbs_g,
              group_id, variant_label, variant_sort, size_value, size_unit,
              milk_scheme_id, choice_scheme_id, volume_scheme_id, modifier_scheme_id
         FROM products WHERE id=?`,
    )
    .get(productId) as ProductRow | undefined
  if (!p) return null

  const groupSchemeId =
    p.group_id != null
      ? ((db.prepare('SELECT modifier_scheme_id AS s FROM product_groups WHERE id=?').get(p.group_id) as
          | { s: number | null }
          | undefined)?.s ?? null)
      : null
  const addonSchemeId = effectiveSchemeId(db, p.modifier_scheme_id, groupSchemeId)
  const choice = choiceForProduct(db, p.choice_scheme_id != null ? Number(p.choice_scheme_id) : null)

  return {
    ok: true,
    productId: Number(p.id),
    name: p.name,
    description: p.description ?? null,
    imageUrl: p.image_url ?? null,
    mediaType: p.media_type === 'video' ? 'video' : 'image',
    videoUrl: p.video_url ?? null,
    posterUrl: p.poster_url ?? null,
    priceRub: Number(p.price) || 0,
    available: Number(p.available) !== 0,
    calories: num(p.calories),
    proteinG: num(p.protein_g),
    fatG: num(p.fat_g),
    carbsG: num(p.carbs_g),
    volumes: buildVolumes(db, p),
    milk: buildMilk(db, p.milk_scheme_id != null ? Number(p.milk_scheme_id) : null),
    choice:
      choice && choice.options.length >= 2
        ? {
            title: choice.title || 'Выберите вариант',
            options: choice.options.map((o) => ({ id: Number(o.id), label: o.label, isDefault: !!o.isDefault })),
          }
        : null,
    addons: buildAddons(db, addonSchemeId),
  }
}
