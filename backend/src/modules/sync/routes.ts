import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { requireAuth, type AuthEnv } from '../../middleware/auth'
import { buildCardProof } from '../loyalty/proof'
import { applyReceipts } from '../loyalty/receipts'

export const syncRoutes = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .post('/', zValidator('json', z.object({ receipts: z.array(z.string().max(3000)).max(200) })), (c) => {
    const userId = c.get('userId')
    const result = applyReceipts(c.req.valid('json').receipts)
    const u = db.prepare('SELECT id, nickname, invite_code, cashback_balance, card_code FROM users WHERE id=?')
      .get(userId) as { id: number; nickname: string; invite_code: string; cashback_balance: number; card_code: string | null }
    return c.json({
      card: buildCardProof(userId),
      me: { id: u.id, nickname: u.nickname, inviteCode: u.invite_code, cashbackBalance: u.cashback_balance, cardCode: u.card_code },
      result,
    })
  })
