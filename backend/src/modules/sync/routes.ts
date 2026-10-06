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
    const u = db.prepare('SELECT id, card_id, card_code, nickname, invite_code, cashback_balance FROM users WHERE id=?')
      .get(userId) as { id: number; card_id: string; card_code: string; nickname: string; invite_code: string; cashback_balance: number }
    return c.json({
      card: buildCardProof(userId),
      me: { id: u.id, cardId: u.card_id, cardCode: u.card_code, nickname: u.nickname, inviteCode: u.invite_code, cashbackBalance: u.cashback_balance },
      result,
    })
  })
