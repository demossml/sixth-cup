import { Hono } from 'hono'
import { db } from '../../db'
import { requireAuth, type AuthEnv } from '../../middleware/auth'
import { buildCardProof, ensureCard, normalizeCardCode } from './proof'
import { freeEarned } from './rules'
import { config } from '../../config'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { resolveAndReserve } from './reservations'

function hitCardRate(userId: number): boolean {
  const key = `card:${userId}`
  const row = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?').get(key) as { count: number; window_start: number } | undefined
  const now = Date.now()
  if (!row || now - row.window_start > 60_000) {
    db.prepare('INSERT OR REPLACE INTO rate_limits(key,count,window_start) VALUES(?,?,?)').run(key, 1, now)
    return true
  }
  if (row.count >= 60) return false
  db.prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').run(key)
  return true
}

function cardView(userId: number) {
  ensureCard(userId)
  const row = db.prepare('SELECT nickname, cashback_balance, card_code FROM users WHERE id=?').get(userId) as {
    nickname: string; cashback_balance: number; card_code: string
  }
  const card = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?').get(userId) as {
    paid_total: number; free_used: number
  }
  const earned = freeEarned(card.paid_total)
  return {
    card: buildCardProof(userId),
    cardCode: row.card_code,
    nickname: row.nickname,
    cashbackRub: Math.floor(row.cashback_balance / 100),
    cupsTowardFree: card.paid_total % config.cupsForFree,
    freeAvailable: Math.max(0, earned - card.free_used),
  }
}

export const cardLookupRoutes = new Hono<AuthEnv>()
  // Public: cash register resolves QR → live state + FREE_CUP reservation (TTL ~90s)
  .post(
    '/resolve',
    zValidator(
      'json',
      z.object({
        c: z.string().min(1).max(4000),
        storeUuid: z.string().max(80).optional().nullable(),
        terminalId: z.string().max(80).optional().nullable(),
        reserveFree: z.boolean().optional(),
      }),
    ),
    (c) => {
      const body = c.req.valid('json')
      return c.json(
        resolveAndReserve({
          cardRef: body.c,
          storeUuid: body.storeUuid,
          terminalId: body.terminalId,
          reserveFree: body.reserveFree,
        }),
      )
    },
  )
  .use('*', requireAuth)
  .get('/card', (c) => {
    const userId = c.get('userId')
    if (!hitCardRate(userId)) return c.json({ error: 'Too many requests' }, 429)
    return c.json(cardView(userId))
  })
  .get('/card/:code', (c) => {
    const requester = c.get('userId')
    if (!hitCardRate(requester)) return c.json({ error: 'Too many requests' }, 429)
    const code = normalizeCardCode(c.req.param('code'))
    if (!code) return c.json({ error: 'Invalid card code' }, 400)
    const user = db.prepare(`
      SELECT id FROM users
      WHERE card_code=? OR CAST(card_code AS INTEGER)=CAST(? AS INTEGER)
      LIMIT 1
    `).get(code, code) as { id: number } | undefined
    if (!user) return c.json({ error: 'Card not found' }, 404)
    return c.json(cardView(user.id))
  })
