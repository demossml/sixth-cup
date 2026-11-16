import { Hono } from 'hono'
import { db } from '../../db'
import { requireAuth, type AuthEnv } from '../../middleware/auth'
import { buildCardProof, ensureCard } from './proof'
import { freeEarned } from './rules'
import { activeVouchers } from '../vouchers/service'
import { effectiveEarnBps } from './settings'
import { config } from '../../config'

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

export function stateView(userId: number) {
  ensureCard(userId)
  const card = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?').get(userId) as { paid_total: number; free_used: number }
  return {
    cupsTowardFree: card.paid_total % config.cupsForFree,
    freeAvailable: Math.max(0, freeEarned(card.paid_total) - card.free_used),
    cupsForFree: config.cupsForFree,
    // BONUS-LOYALTY: PWA по этому флагу показывает баланс бонусов вместо чашек.
    bonusMode: config.loyaltyBonusMode,
    // Какой процент реально начисляется этому гостю (индивидуальный или глобальный).
    effectiveEarnPercent: Math.round(effectiveEarnBps(db, userId)) / 100,
    // Гость видит свои купоны на главной: без этого поля блок купонов в PWA
    // не мог появиться никогда (аудит PWA 15.11.2026).
    vouchers: activeVouchers(userId),
    ...friendsView(userId),
  }
}

export function friendsView(userId: number) {
  // 3.5: награды игры не входят в «кэшбэк от друзей» — это разные источники.
  const g = db
    .prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM cashback_ledger WHERE beneficiary_id=? AND receipt_id NOT LIKE 'game:%'`)
    .get(userId) as { n: number }
  const f = db.prepare('SELECT COUNT(*) AS n FROM users WHERE invited_by=?').get(userId) as { n: number }
  return { fromFriendsRub: Math.floor(Math.max(0, g.n) / 100), fromFriendsKopecks: Math.max(0, g.n), friendsCount: f.n }
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
    cupsForFree: config.cupsForFree,
    vouchers: activeVouchers(userId),
    ...friendsView(userId),
  }
}

export const cardLookupRoutes = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/card', (c) => {
    const userId = c.get('userId')
    if (!hitCardRate(userId)) return c.json({ error: 'Too many requests' }, 429)
    return c.json(cardView(userId))
  })
  /**
   * BONUS-LOYALTY: история движений бонусов для PWA.
   * Только свой баланс: card_id берём из сессии, а не из параметра.
   * `source`/`operation` отдаём как есть, подписи — на клиенте (контракт не ломается).
   */
  .get('/ledger', (c) => {
    const userId = c.get('userId')
    if (!hitCardRate(userId)) return c.json({ error: 'Too many requests' }, 429)
    const limitRaw = Number(c.req.query('limit') ?? 50)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 50
    const me = db.prepare('SELECT card_id, cashback_balance FROM users WHERE id=?').get(userId) as
      | { card_id: string | null; cashback_balance: number }
      | undefined
    if (!me?.card_id) return c.json({ balanceKopecks: 0, effectiveEarnPercent: null, items: [] })
    const items = db
      .prepare(
        `SELECT id, operation AS kind, cashback_delta AS cashbackDelta,
                source_type AS source, source_id AS sourceId, created_at AS at
           FROM loyalty_ledger WHERE card_id=? AND cashback_delta<>0
          ORDER BY id DESC LIMIT ?`,
      )
      .all(me.card_id, limit) as { id: number; kind: string; cashbackDelta: number; source: string; sourceId: string; at: number }[]
    return c.json({
      balanceKopecks: Number(me.cashback_balance ?? 0),
      effectiveEarnPercent: Math.round(effectiveEarnBps(db, userId)) / 100,
      items: items.map((row) => ({ ...row, at: new Date(row.at < 10_000_000_000 ? row.at * 1000 : row.at).toISOString() })),
    })
  })
