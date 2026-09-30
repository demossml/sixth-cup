import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config } from '../../config'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { grantVoucher } from '../vouchers/service'

export const adminRoutes = new Hono()
  .use('*', createMiddleware(async (c, next) => {
    if (c.req.header('X-Admin-Token') !== config.adminToken) throw bad('Forbidden', 403)
    await next()
  }))

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

  .get('/devices', (c) => {
    const rows = db.prepare(`
      SELECT d.id, d.name, d.store_id AS storeId, d.revoked, d.enroll_code AS enrollCode,
             d.public_key IS NOT NULL AS enrolled, d.created_at AS createdAt, s.name AS storeName
      FROM devices d JOIN stores s ON s.id = d.store_id ORDER BY d.id DESC`).all()
    return c.json({ devices: rows })
  })

  .post('/devices', zValidator('json', z.object({ storeId: z.number().int(), name: z.string().min(1).max(60) })), (c) => {
    const { storeId, name } = c.req.valid('json')
    const code = randomBytes(4).toString('hex').toUpperCase()
    const r = db.prepare('INSERT INTO devices(store_id,name,enroll_code,created_at) VALUES(?,?,?,?)')
      .run(storeId, name, code, Date.now())
    return c.json({ id: Number(r.lastInsertRowid), enrollCode: code })
  })

  .post('/devices/:id/revoke', (c) => {
    db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  .get('/promos', (c) => {
    const promos = db.prepare('SELECT id, title, body, icon, sponsor, starts_at AS startsAt, ends_at AS endsAt FROM promos ORDER BY id DESC').all()
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

  .get('/products', (c) => {
    const products = db.prepare('SELECT id, name, price, icon, available FROM products ORDER BY id').all()
    return c.json({ products })
  })

  .post('/products', zValidator('json', z.object({
    id: z.number().int().optional(), name: z.string().min(1).max(60), price: z.number().int().min(0),
    icon: z.string().max(24).default('Coffee'), available: z.boolean().default(true),
  })), (c) => {
    const p = c.req.valid('json')
    if (p.id) db.prepare('UPDATE products SET name=?,price=?,icon=?,available=? WHERE id=?')
      .run(p.name, p.price, p.icon, p.available ? 1 : 0, p.id)
    else db.prepare('INSERT INTO products(name,price,icon,available) VALUES(?,?,?,?)')
      .run(p.name, p.price, p.icon, p.available ? 1 : 0)
    return c.json({ ok: true })
  })

  .get('/stores', (c) => {
    const stores = db.prepare('SELECT id, name, address FROM stores ORDER BY id').all()
    return c.json({ stores })
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
    const rows = db.prepare(`SELECT * FROM cashback_ledger WHERE beneficiary_id=? ORDER BY id DESC LIMIT 50`).all(id)
    const u = db.prepare('SELECT cashback_balance FROM users WHERE id=?').get(id) as { cashback_balance: number } | undefined
    return c.json({ balance: u?.cashback_balance ?? 0, ledger: rows })
  })
