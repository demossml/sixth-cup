import { Hono } from 'hono'
import { db } from '../../db'
import { findUserByCardCode } from '../../lib/cardCode'
import { bad } from '../../lib/errors'

export const cardLookupRoutes = new Hono().get('/card/:code', async (c) => {
  const u = findUserByCardCode(db, c.req.param('code')) as
    | {
        id: number
        nickname: string
        cashback_balance: number
        card_code: string | null
      }
    | undefined
  if (!u) throw bad('Card not found', 404)
  const card = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?').get(u.id) as
    | { paid_total: number; free_used: number }
    | undefined
  const paid = card?.paid_total ?? 0
  const towardFree = paid % 6
  return c.json({
    cardCode: u.card_code,
    nickname: u.nickname,
    cashbackRub: Math.floor((u.cashback_balance || 0) / 100),
    cupsTowardFree: towardFree,
    freeAvailable: towardFree === 0 && paid > 0 ? 1 : 0,
  })
})
