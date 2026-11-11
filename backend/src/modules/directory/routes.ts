import { Hono } from 'hono'
import { config } from '../../config'
import { db } from '../../db'
import { resolveAddonsCategoryIds } from '../catalog/addonScheme'
import { serverKeys, serverPub } from '../../lib/crypto'
import { requireDevice } from '../../middleware/device'
import { guestMenuConfig } from '../catalog/guestMenuConfig'

/** Часы по дням из `stores.hours_json` (7 элементов, null — выходной). Битый json → null. */
function parseHours(raw: string | null): ({ open: string; close: string } | null)[] | null {
  if (!raw) return null
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr) || arr.length !== 7) return null
    return arr.map((d) => (d && typeof d.open === 'string' && typeof d.close === 'string' ? { open: d.open, close: d.close } : null))
  } catch {
    return null
  }
}

function absUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  const base = (config.publicBaseUrl || '').replace(/\/+$/, '')
  if (!base) return url
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`
}

/** Public catalog for PWA. Optional storeUuid filters per-store availability. */
export function publicDirectory(storeUuid?: string | null) {
  const now = Math.floor(Date.now() / 1000)
  const nowMs = Date.now()
  const devices = db.prepare('SELECT id, public_key AS pub, revoked FROM devices WHERE public_key IS NOT NULL')
    .all() as { id: number; pub: string; revoked: number }[]

  const stores = db.prepare(`
    SELECT s.id, s.name, s.address, s.organization_id AS organizationId,
           s.open_time AS openTime, s.close_time AS closeTime, s.lat AS lat, s.lng AS lng,
           s.hours_json AS hoursJson, s.photo_url AS photoUrl, s.photo_full_url AS photoFullUrl,
           s.entrance_hint AS entranceHint, s.phone AS phone
    FROM stores s
  `).all() as {
    id: number; name: string; address: string; organizationId: number | null
    openTime: string | null; closeTime: string | null; lat: number | null; lng: number | null
    hoursJson: string | null; photoUrl: string | null; photoFullUrl: string | null
    entranceHint: string | null; phone: string | null
  }[]

  const organizations = db.prepare(`
    SELECT id, name, legal_name AS legalName, tax_regime AS taxRegime, vat_rate AS vatRate, active
    FROM organizations WHERE active=1
  `).all() as {
    id: number; name: string; legalName: string; taxRegime: string; vatRate: number; active: number
  }[]

  const addonCats = new Set(resolveAddonsCategoryIds(db))
  const categories = (db.prepare(`
    SELECT id, name, sort_order AS sortOrder
    FROM categories WHERE available=1 ORDER BY sort_order, id
  `).all() as { id: number; name: string; sortOrder: number }[]).filter((c) => !addonCats.has(c.id))

  let products = db.prepare(`
    SELECT id, name, price, icon, description, category_id AS categoryId,
           image_url AS imageUrl, sort_order AS sortOrder,
           modifier_scheme_id AS modifierSchemeId,
           counts_as_cup AS countsAsCup, free_eligible AS freeEligible,
           size_value AS sizeValue, size_unit AS sizeUnit, calories,
           protein_g AS proteinG, fat_g AS fatG, carbs_g AS carbsG,
           is_popular AS isPopular, badge,
           media_type AS mediaType, video_url AS videoUrl, poster_url AS posterUrl,
           volume_scheme_id AS volumeSchemeId,
           (SELECT MIN(pvp.price) FROM product_volume_prices pvp
              JOIN volume_scheme_items i ON i.id = pvp.item_id AND i.active = 1
             WHERE pvp.product_id = products.id) AS minVolumePrice,
           group_id AS groupId, variant_label AS variantLabel, variant_sort AS variantSort,
           available AS globalAvailable
    FROM products
    WHERE (season_start_at IS NULL OR season_start_at<=?)
      AND (season_end_at IS NULL OR season_end_at>=?)
    ORDER BY sort_order, id
  `).all(nowMs, nowMs) as Record<string, unknown>[]

  // availability: global flag + optional per-store override
  // Наличие не выбрасывает позицию из каталога: гость видит карточку «Нет в наличии» (как в макете).
  const availability = new Map<number, boolean>()
  if (storeUuid) {
    const rows = db.prepare(
      'SELECT product_id AS productId, available FROM product_store_availability WHERE store_uuid=?',
    ).all(storeUuid) as { productId: number; available: number }[]
    for (const r of rows) availability.set(Number(r.productId), Number(r.available) === 1)
  }
  products = products.map((p) => {
    const id = Number(p.id)
    const storeAvailable = availability.get(id)
    const soldOut = storeAvailable != null ? !storeAvailable : Number(p.globalAvailable) === 0
    return { ...p, soldOut }
  })

  // P0: товары категории «Добавки» не показываем в PWA-меню (и при наличии storeUuid, и без).
  products = products.filter((p) => !(p.categoryId != null && addonCats.has(Number(p.categoryId))))

  // Папки-группы добавок (is_group=1) — контейнеры каталога, а не позиции меню.
  // У них category_id = NULL, поэтому фильтр по категории их не ловит.
  const hasIsGroup = (db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).some(
    (c) => c.name === 'is_group',
  )
  const groupFolderIds = new Set(
    hasIsGroup
      ? (db.prepare('SELECT id FROM products WHERE COALESCE(is_group,0)=1').all() as { id: number }[]).map((r) =>
          Number(r.id),
        )
      : [],
  )
  products = products.filter((p) => !groupFolderIds.has(Number(p.id)))

  const modifiers = db.prepare(`
    SELECT id, name, price, group_key AS groupKey, sort_order AS sortOrder
    FROM modifiers WHERE available=1 ORDER BY sort_order, id
  `).all()

  const schemes = db.prepare(`SELECT id, name FROM modifier_schemes ORDER BY id`).all() as { id: number; name: string }[]
  const schemeItems = db.prepare(`
    SELECT scheme_id AS schemeId, modifier_id AS modifierId, required, max_count AS maxCount
    FROM modifier_scheme_items
  `).all() as { schemeId: number; modifierId: number; required: number; maxCount: number }[]

  // CMS content: published + in date window
  let content: unknown[] = []
  try {
    content = db.prepare(`
      SELECT id, kind, title, body, image_url AS imageUrl, media_type AS mediaType, badge, product_id AS productId,
             placement, cta_label AS ctaLabel, sort_order AS sortOrder,
             tap_action AS tapAction, time_from AS timeFrom, time_to AS timeTo,
             starts_at AS startsAt, ends_at AS endsAt
      FROM promos
      WHERE COALESCE(status,'published')='published'
        AND starts_at<=? AND ends_at>=?
      ORDER BY sort_order ASC, id DESC
    `).all(now, now) as Record<string, unknown>[]
    content = (content as Record<string, unknown>[]).map((row) => ({
      ...row,
      imageUrl: absUrl(row.imageUrl as string | null),
      mediaType: row.mediaType || 'image',
    }))
  } catch {
    // migration not applied yet — fall back to legacy promos shape
    content = db.prepare(`SELECT id, title, body, icon, sponsor, ends_at AS endsAt FROM promos
                          WHERE starts_at<=? AND ends_at>=? ORDER BY id DESC`).all(now, now)
  }

  // legacy promos alias for older clients
  const promos = content

  // Размеры: витрина группы + id её SKU. Клиент показывает одну плитку с выбором объёма.
  let productGroups: Record<string, unknown>[] = []
  try {
    const rows = db.prepare(`
      SELECT id, name, image_url AS imageUrl, category_id AS categoryId, description,
             sort_order AS sortOrder
      FROM product_groups ORDER BY sort_order, id
    `).all() as Record<string, unknown>[]
    productGroups = rows
      .map((g) => {
        const ids = products
          .filter((p) => Number((p as { groupId?: number }).groupId) === Number(g.id))
          .map((p) => Number(p.id))
        return {
          id: Number(g.id),
          name: g.name,
          imageUrl: absUrl(g.imageUrl as string | null),
          categoryId: g.categoryId ?? null,
          description: g.description ?? null,
          sortOrder: g.sortOrder ?? 0,
          variants: ids,
        }
      })
      .filter((g) => g.variants.length > 0)
  } catch {
    productGroups = []
  }

  return {
    serverPub,
    serverKeys,
    cupsForFree: config.cupsForFree,
    referralCashbackPercent: config.referralCashbackPercent,
    currency: config.currency,
    generatedAt: now,
    devices: devices.map((d) => ({
      id: d.id, pub: d.pub, revoked: !!d.revoked,
    })),
    stores: stores.map((s) => ({
      id: s.id, name: s.name, address: s.address, organizationId: s.organizationId,
      openTime: s.openTime ?? null, closeTime: s.closeTime ?? null,
      lat: s.lat ?? null, lng: s.lng ?? null,
      hours: parseHours(s.hoursJson),
      // Витрина точки: фото и ориентир помогают найти её визуально.
      photoUrl: s.photoUrl ?? null,
      photoFullUrl: s.photoFullUrl ?? null,
      entranceHint: s.entranceHint ?? null,
      phone: s.phone ?? null,
    })),
    organizations: organizations.map((o) => ({
      id: o.id, name: o.name, legalName: o.legalName, taxRegime: o.taxRegime, vatRate: o.vatRate,
    })),
    categories,
    modifiers,
    modifierSchemes: schemes.map((s) => ({
      id: s.id,
      name: s.name,
      items: schemeItems
        .filter((i) => i.schemeId === s.id)
        .map((i) => ({
          modifierId: i.modifierId,
          required: !!i.required,
          maxCount: i.maxCount,
        })),
    })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      icon: p.icon,
      description: p.description,
      categoryId: p.categoryId,
      imageUrl: absUrl(p.imageUrl as string | null),
      sortOrder: p.sortOrder ?? 0,
      modifierSchemeId: p.modifierSchemeId ?? null,
      countsAsCup: !!(p as { countsAsCup?: number }).countsAsCup,
      freeEligible: !!(p as { freeEligible?: number }).freeEligible,
      sizeValue: p.sizeValue ?? null,
      sizeUnit: p.sizeUnit ?? null,
      calories: p.calories ?? null,
      proteinG: p.proteinG ?? null,
      fatG: p.fatG ?? null,
      carbsG: p.carbsG ?? null,
      isPopular: !!Number(p.isPopular ?? 0),
      badge: p.badge ?? null,
      soldOut: !!p.soldOut,
      mediaType: p.mediaType === 'video' ? 'video' : 'image',
      videoUrl: absUrl(p.videoUrl as string | null),
      posterUrl: absUrl(p.posterUrl as string | null),
      /** Есть выбор объёма (схема объёмов или группа SKU) — на карточке пишем «от N ₽». */
      hasVolumes: p.volumeSchemeId != null,
      /** Минимальная цена объёма: из цен объёмов, иначе базовая цена товара. */
      priceFrom: p.minVolumePrice != null ? Number(p.minVolumePrice) : Number(p.price) || 0,
      groupId: p.groupId ?? null,
      variantLabel: p.variantLabel ?? null,
      variantSort: p.variantSort ?? 0,
    })),
    productGroups,
    promos,
    content,
  }
}

export const directoryRoutes = new Hono()
  .get('/', (c) => {
    const storeUuid = c.req.query('storeUuid') || c.req.query('store') || null
    return c.json(publicDirectory(storeUuid))
  })
  /**
   * Конфигурация товара для витрины: объёмы с ценами, молоко с доплатой,
   * обязательный выбор без цены и добавки. Всё, что видно на карточке меню.
   */
  /** Координаты и часы точек для выбора кофейни и карт (без персональных данных). */
  .get('/geo', (c) => {
    const rows = db.prepare(`
      SELECT id, name, address, open_time AS openTime, close_time AS closeTime,
             lat, lng, hours_json AS hoursJson, photo_url AS photoUrl, entrance_hint AS entranceHint
      FROM stores ORDER BY id
    `).all() as Array<{
      id: number; name: string; address: string; openTime: string | null; closeTime: string | null
      lat: number | null; lng: number | null; hoursJson: string | null
      photoUrl: string | null; entranceHint: string | null
    }>
    return c.json({
      ok: true,
      stores: rows.map((s) => ({
        id: s.id,
        name: s.name,
        address: s.address,
        openTime: s.openTime,
        closeTime: s.closeTime,
        hours: parseHours(s.hoursJson),
        lat: s.lat,
        lng: s.lng,
        photoUrl: s.photoUrl ?? null,
        entranceHint: s.entranceHint ?? null,
      })),
    })
  })
  .get('/config/:productId', (c) => {
    const id = Number(c.req.param('productId'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ ok: false, error: 'bad_request', message: 'Некорректный товар' }, 400)
    }
    const cfg = guestMenuConfig(db, id)
    if (!cfg) return c.json({ ok: false, error: 'not_found', message: 'Товар не найден' }, 404)
    return c.json(cfg)
  })
  /** Рецепты / себес — только устройство кассы. */
  .get('/staff', requireDevice, (c) => {
    const products = db.prepare(`
      SELECT id, name, price, modifier_scheme_id AS modifierSchemeId,
             recipe_text AS recipeText, recipe_cost_rub AS recipeCostRub,
             recipe_seconds AS recipeSeconds,
             counts_as_cup AS countsAsCup
      FROM products WHERE available=1
        AND (season_start_at IS NULL OR season_start_at<=?)
        AND (season_end_at IS NULL OR season_end_at>=?)
      ORDER BY sort_order, id
    `).all(Date.now(), Date.now())
    return c.json({ products })
  })
