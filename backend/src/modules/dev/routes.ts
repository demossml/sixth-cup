import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { sign } from 'hono/jwt'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config } from '../../config'
import { db } from '../../db'
import { DEMO_CUSTOMER_PHONE, DEMO_FRIEND_PHONE, resetDemo } from '../../db/seed'
import { bad } from '../../lib/errors'

export const devRoutes = new Hono()
  .use('*', createMiddleware(async (c, next) => {
    if (!config.isDev) throw bad('Not found', 404)
    await next()
  }))
  .post('/login', zValidator('json', z.object({ phone: z.string().optional() })), async (c) => {
    const phone = c.req.valid('json').phone ?? DEMO_CUSTOMER_PHONE
    const u = db.prepare('SELECT id, phone, nickname FROM users WHERE phone=?')
      .get(phone) as { id: number; phone: string; nickname: string } | undefined
    if (!u) throw bad('Демо-пользователь не найден', 404)
    const token = await sign({ sub: u.id, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180 }, config.jwtSecret)
    return c.json({ token, user: { id: u.id, phone: u.phone, nickname: u.nickname } })
  })
  .get('/users', (c) => {
    const users = db.prepare(`SELECT u.id, u.phone, u.nickname, u.invite_code AS inviteCode,
        u.invited_by AS invitedBy, u.cashback_balance AS cashbackBalance,
        c.paid_total AS paidTotal, c.free_used AS freeUsed, c.seq
      FROM users u LEFT JOIN cards c ON c.user_id = u.id
      WHERE u.phone IN (?,?)`)
      .all(DEMO_CUSTOMER_PHONE, DEMO_FRIEND_PHONE)
    return c.json({ users })
  })
  .post('/reset', zValidator('json', z.object({})), (c) => {
    resetDemo()
    return c.json({ ok: true })
  })
