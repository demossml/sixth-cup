import { Hono } from 'hono'
import { config } from '../../config'
import { db } from '../../db'
import { serverKeys, serverPub } from '../../lib/crypto'
import { requireDevice } from '../../middleware/device'

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
    SELECT s.id, s.name, s.address, s.organization_id AS organizationId
    FROM stores s
  `).all() as { id: number; name: string; address: string; organizationId: number | null }[]

  const organizations = db.prepare(`
    SELECT id, name, legal_name AS legalName, tax_regime AS taxRegime, vat_rate AS vatRate, active
    FROM organizations WHERE active=1
  `).all() as {
    id: number; name: string; legalName: string; taxRegime: string; vatRate: number; active: number
  }[]

  const categories = db.prepare(`
    SELECT id, name, sort_order AS sortOrder
    FROM categories WHERE available=1 ORDER BY sort_order, id
  `).all() as { id: number; name: string; sortOrder: number }[]

  let products = db.prepare(`
    SELECT id, name, price, icon, description, category_id AS categoryId,
           image_url AS imageUrl, sort_order AS sortOrder,
           modifier_scheme_id AS modifierSchemeId,
           counts_as_cup AS countsAsCup, free_eligible AS freeEligible,
           size_value AS sizeValue, size_unit AS sizeUnit, calories,
           available AS globalAvailable
    FROM products
    WHERE (season_start_at IS NULL OR season_start_at<=?)
      AND (season_end_at IS NULL OR season_end_at>=?)
    ORDER BY sort_order, id
  `).all(nowMs, nowMs) as Record<string, unknown>[]

  // availability: global flag + optional per-store override
  if (storeUuid) {
    const rows = db.prepare(
      'SELECT product_id AS productId, available FROM product_store_availability WHERE store_uuid=?',
    ).all(storeUuid) as { productId: number; available: number }[]
    const map = new Map(rows.map((r) => [r.productId, r.available]))
    products = products.filter((p) => {
      const id = Number(p.id)
      if (map.has(id)) return map.get(id) === 1
      return Number(p.globalAvailable) === 1
    })
  } else {
    products = products.filter((p) => Number(p.globalAvailable) === 1)
  }

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
    })),
    promos,
    content,
  }
}

export const directoryRoutes = new Hono()
  .get('/', (c) => {
    const storeUuid = c.req.query('storeUuid') || c.req.query('store') || null
    return c.json(publicDirectory(storeUuid))
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
