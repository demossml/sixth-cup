import { Hono } from 'hono'
import { config } from '../../config'
import { db } from '../../db'
import { serverPub } from '../../lib/crypto'
import { requireDevice } from '../../middleware/device'

function publicDirectory() {
  const now = Math.floor(Date.now() / 1000)
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

  const products = db.prepare(`
    SELECT id, name, price, icon, description, category_id AS categoryId,
           image_url AS imageUrl, sort_order AS sortOrder,
           modifier_scheme_id AS modifierSchemeId
    FROM products WHERE available=1
    ORDER BY sort_order, id
  `).all() as Record<string, unknown>[]

  const modifiers = db.prepare(`
    SELECT id, name, price, group_key AS groupKey, sort_order AS sortOrder
    FROM modifiers WHERE available=1 ORDER BY sort_order, id
  `).all()

  const schemes = db.prepare(`SELECT id, name FROM modifier_schemes ORDER BY id`).all() as { id: number; name: string }[]
  const schemeItems = db.prepare(`
    SELECT scheme_id AS schemeId, modifier_id AS modifierId, required, max_count AS maxCount
    FROM modifier_scheme_items
  `).all() as { schemeId: number; modifierId: number; required: number; maxCount: number }[]

  const promos = db.prepare(`SELECT id, title, body, icon, sponsor, ends_at AS endsAt FROM promos
                             WHERE starts_at<=? AND ends_at>=? ORDER BY id DESC`)
    .all(now, now)

  return {
    serverPub,
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
      imageUrl: p.imageUrl,
      sortOrder: p.sortOrder ?? 0,
      modifierSchemeId: p.modifierSchemeId ?? null,
    })),
    promos,
  }
}

export const directoryRoutes = new Hono()
  .get('/', (c) => c.json(publicDirectory()))
  /** Рецепты / себес — только устройство кассы. */
  .get('/staff', requireDevice, (c) => {
    const products = db.prepare(`
      SELECT id, name, price, modifier_scheme_id AS modifierSchemeId,
             recipe_text AS recipeText, recipe_cost_rub AS recipeCostRub,
             recipe_seconds AS recipeSeconds
      FROM products WHERE available=1 ORDER BY sort_order, id
    `).all()
    return c.json({ products })
  })
