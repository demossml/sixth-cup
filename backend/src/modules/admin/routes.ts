import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config, TAX_REGIMES } from '../../config'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { grantVoucher } from '../vouchers/service'
import { resetLoyaltyData, resetCatalogData } from '../../db/seed'
import { adminEvotorCatalog } from './evotorCatalog'
import { ProductPushService } from '../../integrations/evotor/sync/ProductPushService'

const adminAuth = createMiddleware(async (c, next) => {
  if (c.req.header('X-Admin-Token') !== config.adminToken) throw bad('Forbidden', 403)
  await next()
})

const taxRegimeZ = z.enum(TAX_REGIMES)

function enqueueProductSync(productIds: number[]) {
  const ids = [...new Set(productIds.filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) return
  const stores = db.prepare('SELECT store_uuid FROM evotor_stores').all() as { store_uuid: string }[]
  for (const store of stores) {
    for (const productId of ids) {
      const existing = db.prepare(`SELECT id FROM evotor_outbox WHERE store_uuid=? AND entity='PRODUCT' AND entity_key=? AND status='PENDING' LIMIT 1`)
        .get(store.store_uuid, String(productId)) as { id: number } | undefined
      if (existing) db.prepare(`UPDATE evotor_outbox SET next_at=?,last_error=NULL WHERE id=?`).run(Date.now(), existing.id)
      else db.prepare(`INSERT INTO evotor_outbox(store_uuid,entity,entity_key,op,priority,status,attempts,next_at) VALUES(?,?,?,?,5,'PENDING',0,?)`)
        .run(store.store_uuid, 'PRODUCT', String(productId), 'UPSERT', Date.now())
    }
  }
}

export const adminRoutes = new Hono()
  .use('*', adminAuth)

  // —— Stats (unchanged contract) ——
  .get('/stats', (c) => {
    const users = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    const receipts = (db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as { n: number }).n
    const freeCups = (db.prepare('SELECT COALESCE(SUM(df),0) AS n FROM receipts').get() as { n: number }).n
    const cashbackGranted = (db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM cashback_ledger').get() as { n: number }).n
    const cashbackSpent = (db.prepare('SELECT COALESCE(SUM(dcb),0) AS n FROM receipts').get() as { n: number }).n
    const amountTotal = (db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM receipts').get() as { n: number }).n
    const dayAgo = Date.now() - 86_400_000
    const receiptsToday = (db.prepare('SELECT COUNT(*) AS n FROM receipts WHERE applied_at>=?').get(dayAgo) as { n: number }).n
    return c.json({
      users, receipts, receiptsToday, freeCups, cashbackGranted, cashbackSpent, amountTotal,
    })
  })

  /** mode: loyalty | catalog | full */
  .post('/reset', zValidator('json', z.object({
    mode: z.enum(['loyalty', 'catalog', 'full']),
    confirm: z.literal(true),
  })), (c) => {
    const { mode } = c.req.valid('json')
    if (mode === 'loyalty' || mode === 'full') resetLoyaltyData()
    if (mode === 'catalog' || mode === 'full') resetCatalogData()
    return c.json({ ok: true, mode })
  })

  // —— Organizations ——
  .get('/organizations', (c) => {
    const rows = db.prepare(`
      SELECT id, name, legal_name AS legalName, inn, kpp, tax_regime AS taxRegime,
             vat_rate AS vatRate, active, created_at AS createdAt, updated_at AS updatedAt
      FROM organizations ORDER BY id
    `).all()
    return c.json({ organizations: rows })
  })

  .get('/organizations/:id', (c) => {
    const id = Number(c.req.param('id'))
    const row = db.prepare(`
      SELECT id, name, legal_name AS legalName, inn, kpp, tax_regime AS taxRegime,
             vat_rate AS vatRate, active, created_at AS createdAt, updated_at AS updatedAt
      FROM organizations WHERE id=?
    `).get(id)
    if (!row) throw bad('Organization not found', 404)
    return c.json({ organization: row })
  })

  .post('/organizations', zValidator('json', z.object({
    name: z.string().min(1).max(120),
    legalName: z.string().min(1).max(200),
    inn: z.string().min(10).max(12),
    kpp: z.string().max(9).optional().nullable(),
    taxRegime: taxRegimeZ.default('usn_income'),
    vatRate: z.number().int().min(0).max(22).default(0),
    active: z.boolean().default(true),
  })), (c) => {
    const p = c.req.valid('json')
    const t = Date.now()
    const r = db.prepare(`
      INSERT INTO organizations(name, legal_name, inn, kpp, tax_regime, vat_rate, active, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(p.name, p.legalName, p.inn, p.kpp ?? null, p.taxRegime, p.vatRate, p.active ? 1 : 0, t, t)
    return c.json({ id: Number(r.lastInsertRowid) })
  })

  .patch('/organizations/:id', zValidator('json', z.object({
    name: z.string().min(1).max(120).optional(),
    legalName: z.string().min(1).max(200).optional(),
    inn: z.string().min(10).max(12).optional(),
    kpp: z.string().max(9).optional().nullable(),
    taxRegime: taxRegimeZ.optional(),
    vatRate: z.number().int().min(0).max(22).optional(),
    active: z.boolean().optional(),
  })), (c) => {
    const id = Number(c.req.param('id'))
    const cur = db.prepare('SELECT id FROM organizations WHERE id=?').get(id)
    if (!cur) throw bad('Organization not found', 404)
    const p = c.req.valid('json')
    const row = db.prepare('SELECT * FROM organizations WHERE id=?').get(id) as Record<string, unknown>
    db.prepare(`
      UPDATE organizations SET name=?, legal_name=?, inn=?, kpp=?, tax_regime=?, vat_rate=?, active=?, updated_at=?
      WHERE id=?
    `).run(
      p.name ?? row.name,
      p.legalName ?? row.legal_name,
      p.inn ?? row.inn,
      p.kpp !== undefined ? p.kpp : row.kpp,
      p.taxRegime ?? row.tax_regime,
      p.vatRate ?? row.vat_rate,
      p.active !== undefined ? (p.active ? 1 : 0) : row.active,
      Date.now(),
      id
    )
    return c.json({ ok: true })
  })

  .delete('/organizations/:id', (c) => {
    const id = Number(c.req.param('id'))
    const stores = db.prepare('SELECT COUNT(*) AS n FROM stores WHERE organization_id=?').get(id) as { n: number }
    if (stores.n > 0) throw bad('Сначала удалите или переназначьте точки', 409)
    db.prepare('DELETE FROM organizations WHERE id=?').run(id)
    return c.json({ ok: true })
  })

  // —— Stores ——
  .get('/stores', (c) => {
    const stores = db.prepare(`
      SELECT s.id, s.name, s.address, s.organization_id AS organizationId,
             o.name AS organizationName
      FROM stores s
      LEFT JOIN organizations o ON o.id = s.organization_id
      ORDER BY s.id
    `).all()
    return c.json({ stores })
  })

  .get('/stores/:id', (c) => {
    const id = Number(c.req.param('id'))
    const store = db.prepare(`
      SELECT s.id, s.name, s.address, s.organization_id AS organizationId,
             o.name AS organizationName, o.tax_regime AS taxRegime, o.vat_rate AS vatRate
      FROM stores s
      LEFT JOIN organizations o ON o.id = s.organization_id
      WHERE s.id=?
    `).get(id)
    if (!store) throw bad('Store not found', 404)
    return c.json({ store })
  })

  .post('/stores', zValidator('json', z.object({
    name: z.string().min(1).max(80),
    address: z.string().min(1).max(200),
    organizationId: z.number().int().positive(),
  })), (c) => {
    const p = c.req.valid('json')
    const org = db.prepare('SELECT id FROM organizations WHERE id=?').get(p.organizationId)
    if (!org) throw bad('Organization not found', 404)
    const r = db.prepare('INSERT INTO stores(name, address, organization_id) VALUES(?,?,?)')
      .run(p.name, p.address, p.organizationId)
    return c.json({ id: Number(r.lastInsertRowid) })
  })

  .patch('/stores/:id', zValidator('json', z.object({
    name: z.string().min(1).max(80).optional(),
    address: z.string().min(1).max(200).optional(),
    organizationId: z.number().int().positive().optional(),
  })), (c) => {
    const id = Number(c.req.param('id'))
    const cur = db.prepare('SELECT * FROM stores WHERE id=?').get(id) as
      | { name: string; address: string; organization_id: number | null }
      | undefined
    if (!cur) throw bad('Store not found', 404)
    const p = c.req.valid('json')
    if (p.organizationId != null) {
      const org = db.prepare('SELECT id FROM organizations WHERE id=?').get(p.organizationId)
      if (!org) throw bad('Organization not found', 404)
    }
    db.prepare('UPDATE stores SET name=?, address=?, organization_id=? WHERE id=?').run(
      p.name ?? cur.name,
      p.address ?? cur.address,
      p.organizationId ?? cur.organization_id,
      id
    )
    return c.json({ ok: true })
  })

  // —— Devices (existing) ——
  .delete('/stores/:id', (c) => {
    const id = Number(c.req.param('id'))
    const dev = db.prepare('SELECT COUNT(*) AS n FROM devices WHERE store_id=? AND revoked=0').get(id) as { n: number }
    if (dev.n > 0) throw bad('Есть активные кассы на точке', 409)
    db.prepare('DELETE FROM devices WHERE store_id=?').run(id)
    db.prepare('DELETE FROM stores WHERE id=?').run(id)
    return c.json({ ok: true })
  })

  .get('/devices', (c) => {
    const rows = db.prepare(`
      SELECT d.id, d.name, d.store_id AS storeId, d.revoked, d.enroll_code AS enrollCode,
             d.public_key IS NOT NULL AS enrolled, d.created_at AS createdAt, s.name AS storeName
      FROM devices d JOIN stores s ON s.id = d.store_id ORDER BY d.id DESC`).all()
    return c.json({ devices: rows })
  })

  .post('/devices', zValidator('json', z.object({ storeId: z.number().int(), name: z.string().min(1).max(60) })), (c) => {
    const { storeId, name } = c.req.valid('json')
    const store = db.prepare('SELECT id FROM stores WHERE id=?').get(storeId)
    if (!store) throw bad('Store not found', 404)
    const code = randomBytes(4).toString('hex').toUpperCase()
    const r = db.prepare('INSERT INTO devices(store_id,name,enroll_code,created_at) VALUES(?,?,?,?)')
      .run(storeId, name, code, Date.now())
    return c.json({ id: Number(r.lastInsertRowid), enrollCode: code })
  })

  .post('/devices/:id/revoke', (c) => {
    db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  .delete('/devices/:id', (c) => {
    db.prepare('DELETE FROM devices WHERE id=?').run(Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  // —— Categories ——
  .get('/categories', (c) => {
    const categories = db.prepare(`
      SELECT id, name, sort_order AS sortOrder, available, created_at AS createdAt, updated_at AS updatedAt
      FROM categories ORDER BY sort_order, id
    `).all()
    return c.json({ categories })
  })

  .get('/categories/:id', (c) => {
    const id = Number(c.req.param('id'))
    const category = db.prepare(`
      SELECT id, name, sort_order AS sortOrder, available, created_at AS createdAt, updated_at AS updatedAt
      FROM categories WHERE id=?
    `).get(id)
    if (!category) throw bad('Category not found', 404)
    return c.json({ category })
  })

  .post('/categories', zValidator('json', z.object({
    name: z.string().min(1).max(60),
    sortOrder: z.number().int().default(0),
    available: z.boolean().default(true),
  })), (c) => {
    const p = c.req.valid('json')
    const t = Date.now()
    const r = db.prepare(
      'INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,?,?,?)'
    ).run(p.name, p.sortOrder, p.available ? 1 : 0, t, t)
    return c.json({ id: Number(r.lastInsertRowid) })
  })

  .patch('/categories/:id', zValidator('json', z.object({
    name: z.string().min(1).max(60).optional(),
    sortOrder: z.number().int().optional(),
    available: z.boolean().optional(),
  })), (c) => {
    const id = Number(c.req.param('id'))
    const cur = db.prepare('SELECT * FROM categories WHERE id=?').get(id) as
      | { name: string; sort_order: number; available: number }
      | undefined
    if (!cur) throw bad('Category not found', 404)
    const p = c.req.valid('json')
    db.prepare('UPDATE categories SET name=?, sort_order=?, available=?, updated_at=? WHERE id=?').run(
      p.name ?? cur.name,
      p.sortOrder ?? cur.sort_order,
      p.available !== undefined ? (p.available ? 1 : 0) : cur.available,
      Date.now(),
      id
    )
    return c.json({ ok: true })
  })

  .delete('/categories/:id', (c) => {
    const id = Number(c.req.param('id'))
    const used = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id=?').get(id) as { n: number }
    if (used.n > 0) throw bad('Category has products', 409)
    db.prepare('DELETE FROM categories WHERE id=?').run(id)
    return c.json({ ok: true })
  })

  // —— Products (extended, backward compatible) ——
  .get('/products', (c) => {
    const products = db.prepare(`
      SELECT p.id, p.name, p.price, p.icon, p.available,
             p.description, p.category_id AS categoryId, p.image_url AS imageUrl,
             p.sort_order AS sortOrder, p.created_at AS createdAt, p.updated_at AS updatedAt,
             c.name AS categoryName,
             p.modifier_scheme_id AS modifierSchemeId,
             p.recipe_text AS recipeText,
             p.recipe_cost_rub AS recipeCostRub,
             p.recipe_seconds AS recipeSeconds,
             p.counts_as_cup AS countsAsCup, p.free_eligible AS freeEligible,
             p.tax AS tax, p.measure AS measure, p.cost_price_kopecks AS costPriceKopecks,
             p.season_start_at AS seasonStartAt, p.season_end_at AS seasonEndAt,
             p.evotor_extra_json AS evotorExtraJson,
             p.catalog_source AS catalogSource, p.evotor_uuid AS evotorUuid
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.sort_order, p.id
    `).all() as Record<string, unknown>[]
    const links = db.prepare(`
      SELECT product_id AS productId, store_uuid AS storeUuid, evotor_uuid AS evotorUuid,
             last_pushed_at AS lastPushedAt, last_pulled_at AS lastPulledAt, last_error AS lastError
      FROM product_store_links ORDER BY store_uuid, product_id
    `).all() as Record<string, unknown>[]
    const byProduct = new Map<number, Record<string, unknown>[]>()
    for (const link of links) {
      const id = Number(link.productId)
      const list = byProduct.get(id) ?? []
      list.push(link)
      byProduct.set(id, list)
    }
    return c.json({ products: products.map((p) => ({ ...p, evotorLinks: byProduct.get(Number(p.id)) ?? [] })) })
  })

  .post('/products', zValidator('json', z.object({
    id: z.number().int().optional(),
    name: z.string().min(1).max(60),
    price: z.number().int().min(0),
    icon: z.string().max(24).default('Coffee'),
    available: z.boolean().default(true),
    description: z.string().max(500).optional().nullable(),
    categoryId: z.number().int().positive().optional().nullable(),
    imageUrl: z.string().max(500).optional().nullable(),
    sortOrder: z.number().int().default(0),
    modifierSchemeId: z.number().int().positive().optional().nullable(),
    recipeText: z.string().max(4000).optional().nullable(),
    recipeCostRub: z.number().int().min(0).optional().nullable(),
    recipeSeconds: z.number().int().min(0).optional().nullable(),
    countsAsCup: z.boolean().optional(),
    freeEligible: z.boolean().optional(),
    tax: z.string().max(32).optional(),
    measure: z.string().max(16).optional(),
    costPriceKopecks: z.number().int().min(0).optional(),
    seasonStartAt: z.number().int().nullable().optional(),
    seasonEndAt: z.number().int().nullable().optional(),
    evotorExtraJson: z.string().max(20000).nullable().optional(),
  })), (c) => {
    const p = c.req.valid('json')
    if (p.categoryId != null) {
      const cat = db.prepare('SELECT id FROM categories WHERE id=?').get(p.categoryId)
      if (!cat) throw bad('Category not found', 404)
    }
    const t = Date.now()
    if (p.id) {
      const exists = db.prepare('SELECT id FROM products WHERE id=?').get(p.id)
      if (!exists) throw bad('Product not found', 404)
      db.prepare(`
        UPDATE products SET name=?, price=?, icon=?, available=?, description=?,
          category_id=?, image_url=?, sort_order=?, updated_at=?,
          modifier_scheme_id=?, recipe_text=?, recipe_cost_rub=?, recipe_seconds=?,
          counts_as_cup=COALESCE(?, counts_as_cup), free_eligible=COALESCE(?, free_eligible),
          tax=COALESCE(?, tax), measure=COALESCE(?, measure), cost_price_kopecks=COALESCE(?, cost_price_kopecks),
          season_start_at=?, season_end_at=?, evotor_extra_json=?, catalog_source='SIXTH_CUP'
        WHERE id=?
      `).run(
        p.name, p.price, p.icon, p.available ? 1 : 0,
        p.description ?? null, p.categoryId ?? null, p.imageUrl ?? null,
        p.sortOrder, t,
        p.modifierSchemeId ?? null, p.recipeText ?? null, p.recipeCostRub ?? null, p.recipeSeconds ?? null,
        p.countsAsCup === undefined ? null : (p.countsAsCup ? 1 : 0),
        p.freeEligible === undefined ? null : (p.freeEligible ? 1 : 0),
        p.tax ?? null, p.measure ?? null, p.costPriceKopecks ?? null,
        p.seasonStartAt ?? null, p.seasonEndAt ?? null, p.evotorExtraJson ?? null, p.id
      )
    } else {
      db.prepare(`
        INSERT INTO products(name,price,icon,available,description,category_id,image_url,sort_order,created_at,updated_at,
          modifier_scheme_id,recipe_text,recipe_cost_rub,recipe_seconds,counts_as_cup,free_eligible,tax,measure,cost_price_kopecks,season_start_at,season_end_at,evotor_extra_json,catalog_source)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SIXTH_CUP')
      `).run(
        p.name, p.price, p.icon, p.available ? 1 : 0,
        p.description ?? null, p.categoryId ?? null, p.imageUrl ?? null,
        p.sortOrder, t, t,
        p.modifierSchemeId ?? null, p.recipeText ?? null, p.recipeCostRub ?? null, p.recipeSeconds ?? null,
        p.countsAsCup ? 1 : 0, p.freeEligible ? 1 : 0, p.tax ?? 'NO_VAT', p.measure ?? 'шт',
        p.costPriceKopecks ?? 0, p.seasonStartAt ?? null, p.seasonEndAt ?? null, p.evotorExtraJson ?? null
      )
    }
    const productId = p.id ?? Number(db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number })
    enqueueProductSync([productId])
    return c.json({ ok: true, id: productId })
  })

  .delete('/products/:id', (c) => {
    const id = Number(c.req.param('id'))
    db.prepare("UPDATE products SET available=0, updated_at=?, catalog_source='SIXTH_CUP' WHERE id=?").run(Date.now(), id)
    enqueueProductSync([id])
    return c.json({ ok: true, disabled: true })
  })

  .get('/modifiers', (c) => {
    const modifiers = db.prepare(`
      SELECT id, name, price, group_key AS groupKey, available, sort_order AS sortOrder
      FROM modifiers ORDER BY sort_order, id
    `).all()
    return c.json({ modifiers })
  })

  .post('/modifiers', zValidator('json', z.object({
    id: z.number().int().optional(),
    name: z.string().min(1).max(60),
    price: z.number().int().min(0),
    groupKey: z.enum(['syrup', 'topping', 'milk', 'other']).default('other'),
    available: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  })), (c) => {
    const p = c.req.valid('json')
    const t = Date.now()
    let modifierId = p.id
    if (p.id) {
      db.prepare(`UPDATE modifiers SET name=?, price=?, group_key=?, available=?, sort_order=?, updated_at=? WHERE id=?`)
        .run(p.name, p.price, p.groupKey, p.available ? 1 : 0, p.sortOrder, t, p.id)
    } else {
      const created = db.prepare(`INSERT INTO modifiers(name,price,group_key,available,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
        .run(p.name, p.price, p.groupKey, p.available ? 1 : 0, p.sortOrder, t, t)
      modifierId = Number(created.lastInsertRowid)
    }
    const affected = db.prepare(`SELECT id FROM products WHERE modifier_scheme_id IN (SELECT scheme_id FROM modifier_scheme_items WHERE modifier_id=?)`).all(modifierId) as { id: number }[]
    enqueueProductSync(affected.map((x) => x.id))
    return c.json({ ok: true })
  })

  .delete('/modifiers/:id', (c) => {
    const id = Number(c.req.param('id'))
    const affected = db.prepare(`SELECT p.id FROM products p JOIN modifier_scheme_items i ON i.scheme_id=p.modifier_scheme_id WHERE i.modifier_id=?`).all(id) as { id: number }[]
    db.prepare('DELETE FROM modifiers WHERE id=?').run(id)
    enqueueProductSync(affected.map((x) => x.id))
    return c.json({ ok: true })
  })

  .get('/modifier-schemes', (c) => {
    const schemes = db.prepare('SELECT id, name FROM modifier_schemes ORDER BY id').all() as { id: number; name: string }[]
    const items = db.prepare(`
      SELECT scheme_id AS schemeId, modifier_id AS modifierId, required, max_count AS maxCount
      FROM modifier_scheme_items
    `).all()
    return c.json({
      schemes: schemes.map((s) => ({
        id: s.id,
        name: s.name,
        items: items.filter((i: any) => i.schemeId === s.id),
      })),
    })
  })

  .post('/modifier-schemes', zValidator('json', z.object({
    id: z.number().int().optional(),
    name: z.string().min(1).max(80),
    modifierIds: z.array(z.number().int()).default([]),
    copyFromSchemeId: z.number().int().optional(),
  })), (c) => {
    const p = c.req.valid('json')
    const t = Date.now()
    let schemeId = p.id
    if (schemeId) {
      db.prepare('UPDATE modifier_schemes SET name=?, updated_at=? WHERE id=?').run(p.name, t, schemeId)
      db.prepare('DELETE FROM modifier_scheme_items WHERE scheme_id=?').run(schemeId)
    } else {
      const r = db.prepare('INSERT INTO modifier_schemes(name,created_at,updated_at) VALUES(?,?,?)').run(p.name, t, t)
      schemeId = Number(r.lastInsertRowid)
    }
    let ids = p.modifierIds
    if (p.copyFromSchemeId) {
      const copied = db.prepare('SELECT modifier_id AS id FROM modifier_scheme_items WHERE scheme_id=?')
        .all(p.copyFromSchemeId) as { id: number }[]
      ids = copied.map((x) => x.id)
    }
    const ins = db.prepare(
      'INSERT OR IGNORE INTO modifier_scheme_items(scheme_id,modifier_id,required,max_count) VALUES(?,?,0,2)'
    )
    for (const mid of ids) ins.run(schemeId, mid)
    const affected = db.prepare('SELECT id FROM products WHERE modifier_scheme_id=?').all(schemeId) as { id: number }[]
    enqueueProductSync(affected.map((x) => x.id))
    return c.json({ ok: true, id: schemeId })
  })

  .delete('/modifier-schemes/:id', (c) => {
    const id = Number(c.req.param('id'))
    const affected = db.prepare('SELECT id FROM products WHERE modifier_scheme_id=?').all(id) as { id: number }[]
    db.prepare('UPDATE products SET modifier_scheme_id=NULL, updated_at=? WHERE modifier_scheme_id=?').run(Date.now(), id)
    db.prepare('DELETE FROM modifier_scheme_items WHERE scheme_id=?').run(id)
    db.prepare('DELETE FROM modifier_schemes WHERE id=?').run(id)
    enqueueProductSync(affected.map((x) => x.id))
    return c.json({ ok: true })
  })

  // —— Promos / vouchers / disputes / cashback (existing) ——
  .get('/promos', (c) => {
    const promos = db.prepare(
      'SELECT id, title, body, icon, sponsor, starts_at AS startsAt, ends_at AS endsAt FROM promos ORDER BY id DESC'
    ).all()
    return c.json({ promos })
  })

  .post('/promos', zValidator('json', z.object({
    title: z.string().min(1).max(80), body: z.string().max(300), icon: z.string().max(24).default('Sparkles'),
    sponsor: z.string().max(80).optional(), days: z.number().int().min(1).max(365),
  })), (c) => {
    const p = c.req.valid('json')
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO promos(title,body,icon,sponsor,starts_at,ends_at) VALUES(?,?,?,?,?,?)')
      .run(p.title, p.body, p.icon, p.sponsor ?? null, now, now + p.days * 86_400)
    return c.json({ ok: true })
  })

  .patch('/promos/:id', zValidator('json', z.object({
    title: z.string().min(1).max(80).optional(),
    body: z.string().max(300).optional(),
    icon: z.string().max(24).optional(),
    sponsor: z.string().max(80).optional().nullable(),
    days: z.number().int().min(1).max(365).optional(),
  })), (c) => {
    const id = Number(c.req.param('id'))
    const p = c.req.valid('json')
    const row = db.prepare('SELECT * FROM promos WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) throw bad('Promo not found', 404)
    const now = Math.floor(Date.now() / 1000)
    const ends = p.days != null ? now + p.days * 86_400 : row.ends_at
    db.prepare(`UPDATE promos SET title=?, body=?, icon=?, sponsor=?, ends_at=? WHERE id=?`).run(
      p.title ?? row.title,
      p.body ?? row.body,
      p.icon ?? row.icon,
      p.sponsor !== undefined ? p.sponsor : row.sponsor,
      ends,
      id,
    )
    return c.json({ ok: true })
  })

  .delete('/promos/:id', (c) => {
    db.prepare('DELETE FROM promos WHERE id=?').run(Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  .post('/vouchers/grant-all', zValidator('json', z.object({ code: z.string() })), (c) => {
    const ids = db.prepare('SELECT id FROM users').all() as { id: number }[]
    db.transaction(() => { for (const u of ids) grantVoucher(u.id, c.req.valid('json').code) })()
    return c.json({ granted: ids.length })
  })

  .get('/disputes', (c) => c.json({
    disputes: db.prepare('SELECT * FROM disputes ORDER BY id DESC LIMIT 100').all(),
  }))

  .get('/cashback/:userId', (c) => {
    const id = Number(c.req.param('userId'))
    const rows = db.prepare(`SELECT * FROM cashback_ledger WHERE beneficiary_id=? ORDER BY id DESC LIMIT 100`).all(id)
    return c.json({ ledger: rows })
  })

  // Evotor catalog admin (stores from cloud + product push, no local device enroll)
  .route('/', adminEvotorCatalog)
