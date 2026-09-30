import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config, TAX_REGIMES } from '../../config'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { grantVoucher } from '../vouchers/service'

const adminAuth = createMiddleware(async (c, next) => {
  if (c.req.header('X-Admin-Token') !== config.adminToken) throw bad('Forbidden', 403)
  await next()
})

const taxRegimeZ = z.enum(TAX_REGIMES)

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
    vatRate: z.number().int().min(0).max(20).default(0),
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
    vatRate: z.number().int().min(0).max(20).optional(),
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
             c.name AS categoryName
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.sort_order, p.id
    `).all()
    return c.json({ products })
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
  })), (c) => {
    const p = c.req.valid('json')
    if (p.categoryId != null) {
      const cat = db.prepare('SELECT id FROM categories WHERE id=?').get(p.categoryId)
      if (!cat) throw bad('Category not found', 404)
    }
    const t = Date.now()
    if (p.id) {
      db.prepare(`
        UPDATE products SET name=?, price=?, icon=?, available=?, description=?,
          category_id=?, image_url=?, sort_order=?, updated_at=? WHERE id=?
      `).run(
        p.name, p.price, p.icon, p.available ? 1 : 0,
        p.description ?? null, p.categoryId ?? null, p.imageUrl ?? null,
        p.sortOrder, t, p.id
      )
    } else {
      db.prepare(`
        INSERT INTO products(name,price,icon,available,description,category_id,image_url,sort_order,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
      `).run(
        p.name, p.price, p.icon, p.available ? 1 : 0,
        p.description ?? null, p.categoryId ?? null, p.imageUrl ?? null,
        p.sortOrder, t, t
      )
    }
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
