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

  .post('/promos', zValidator('json', z.object({
    title: z.string().min(1).max(80), body: z.string().max(300), emoji: z.string().max(4).default('🎉'),
    sponsor: z.string().max(80).optional(), days: z.number().int().min(1).max(365),
  })), (c) => {
    const p = c.req.valid('json')
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO promos(title,body,emoji,sponsor,starts_at,ends_at) VALUES(?,?,?,?,?,?)')
      .run(p.title, p.body, p.emoji, p.sponsor ?? null, now, now + p.days * 86_400)
    return c.json({ ok: true })
  })

  .delete('/promos/:id', (c) => {
    db.prepare('DELETE FROM promos WHERE id=?').run(Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  .post('/products', zValidator('json', z.object({
    id: z.number().int().optional(), name: z.string().min(1).max(60), price: z.number().int().min(0),
    emoji: z.string().max(4).default('☕'), available: z.boolean().default(true),
  })), (c) => {
    const p = c.req.valid('json')
    if (p.id) db.prepare('UPDATE products SET name=?,price=?,emoji=?,available=? WHERE id=?')
      .run(p.name, p.price, p.emoji, p.available ? 1 : 0, p.id)
    else db.prepare('INSERT INTO products(name,price,emoji,available) VALUES(?,?,?,?)')
      .run(p.name, p.price, p.emoji, p.available ? 1 : 0)
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
    const rows = db.prepare(`SELECT * FROM cashback_ledger WHERE beneficiary_id=? ORDER BY id DESC LIMIT 50`).all(id)
    const u = db.prepare('SELECT cashback_balance FROM users WHERE id=?').get(id) as { cashback_balance: number } | undefined
    return c.json({ balance: u?.cashback_balance ?? 0, ledger: rows })
  })
