import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { requireAuth, type AuthEnv } from '../../middleware/auth'
import { buildCardProof } from '../loyalty/proof'
import { activeVouchers } from '../vouchers/service'
import { applyReceipts } from '../loyalty/receipts'
import { stateView } from '../loyalty/cardLookup'

export const syncRoutes = new Hono<AuthEnv>()
  .use('*', requireAuth)

  .get('/history', (c) => {
    const userId = c.get('userId')
    const limitRaw = Number(c.req.query('limit') ?? 30)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 30
    const offsetRaw = Number(c.req.query('cursor') ?? 0)
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0
    const user = db.prepare('SELECT card_id FROM users WHERE id=?').get(userId) as { card_id: string } | undefined
    if (!user) return c.json({ items: [], nextCursor: null })
    // Client history v1 policy B: confirmed sales/refunds from loyalty_ops +
    // referral cashback only. loyalty_ledger is intentionally excluded because
    // its earn/progress rows can duplicate the same SELL shown in loyalty_ops.
    const rows = db.prepare(`
      SELECT at, id, kind, title, cupsDelta, freeDelta, cashbackDeltaKop, resultRub, reason FROM (
        -- 3.7: freeDelta и reason добавлены к прежним полям (контракт не ломается)
        SELECT created_at AS at, 'op:' || doc_store || ':' || doc_id AS id,
          CASE WHEN kind='PAYBACK' THEN 'payback' ELSE 'SELL' END AS kind,
          CASE WHEN kind='PAYBACK' THEN 'Возврат покупки' ELSE 'Покупка' END AS title,
          CASE WHEN kind='PAYBACK' THEN -COALESCE(cups_counted,0) ELSE COALESCE(cups_counted,0) END AS cupsDelta,
          CASE WHEN kind='PAYBACK' THEN COALESCE(free,0) ELSE -COALESCE(free,0) END AS freeDelta,
          0 AS cashbackDeltaKop, result_rub AS resultRub,
          CASE
            WHEN EXISTS(SELECT 1 FROM disputes d WHERE d.kind='loyalty_claim_clamped' AND d.receipt_id=loyalty_ops.doc_id) THEN 'bonus_clamped'
            WHEN kind='SELL' AND COALESCE(free,0)>0 THEN 'free_applied'
            WHEN kind='SELL' AND COALESCE(cups_counted,0)=0 THEN 'no_cup_positions'
            ELSE NULL
          END AS reason
        FROM loyalty_ops WHERE card_id=? AND kind IN ('SELL','PAYBACK')
        -- L-08: отдельные строки за кэшбэк, чтобы не подменять сумму покупки
        UNION ALL
        SELECT created_at AS at, 'spend:' || doc_store || ':' || doc_id AS id, 'cashback_spend' AS kind,
          'Списано кэшбэком' AS title, 0 AS cupsDelta, 0 AS freeDelta, -cb AS cashbackDeltaKop, NULL AS resultRub, NULL AS reason
        FROM loyalty_ops WHERE card_id=? AND kind='SELL' AND COALESCE(cb,0)>0
        UNION ALL
        SELECT created_at AS at, 'cbback:' || doc_store || ':' || doc_id AS id, 'cashback_back' AS kind,
          'Кэшбэк возвращён' AS title, 0 AS cupsDelta, 0 AS freeDelta, cb AS cashbackDeltaKop, NULL AS resultRub, NULL AS reason
        FROM loyalty_ops WHERE card_id=? AND kind='PAYBACK' AND COALESCE(cb,0)>0
        -- 3.5: игра и рефералка — разные источники, их нельзя смешивать в одной подписи
        UNION ALL
        SELECT l.created_at AS at, 'referral:' || l.id AS id, 'referral' AS kind,
          'Кэшбэк от покупок друга' AS title, 0 AS cupsDelta, 0 AS freeDelta, l.amount AS cashbackDeltaKop, NULL AS resultRub, NULL AS reason
        FROM cashback_ledger l
        WHERE l.beneficiary_id=? AND l.amount>0 AND l.receipt_id NOT LIKE 'game:%'
        UNION ALL
        SELECT l.created_at AS at, 'referral_rev:' || l.id AS id, 'referral_reversal' AS kind,
          'Возврат кэшбэка за друга' AS title, 0 AS cupsDelta, 0 AS freeDelta, l.amount AS cashbackDeltaKop, NULL AS resultRub, NULL AS reason
        FROM cashback_ledger l
        WHERE l.beneficiary_id=? AND l.amount<0 AND l.receipt_id NOT LIKE 'game:%'
        UNION ALL
        SELECT l.created_at AS at, 'game:' || l.id AS id, 'game_reward' AS kind,
          'Награда за игру' AS title, 0 AS cupsDelta, 0 AS freeDelta, l.amount AS cashbackDeltaKop, NULL AS resultRub, NULL AS reason
        FROM cashback_ledger l WHERE l.beneficiary_id=? AND l.receipt_id LIKE 'game:%'
      ) ORDER BY at DESC, id DESC LIMIT ? OFFSET ?
    `).all(user.card_id, user.card_id, user.card_id, userId, userId, userId, limit + 1, offset) as Array<{
      at:number; id:string; kind:string; title:string; cupsDelta:number; freeDelta:number;
      cashbackDeltaKop:number; resultRub:number|null; reason:string|null
    }>
    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map(r => ({
      id: r.id, at: new Date(r.at < 10_000_000_000 ? r.at * 1000 : r.at).toISOString(),
      kind: r.kind, title: r.title, cupsDelta: r.cupsDelta, freeDelta: r.freeDelta,
      cashbackDeltaKop: r.cashbackDeltaKop, resultRub: r.resultRub, reason: r.reason,
      status: 'confirmed' as const,
    }))
    return c.json({ items, nextCursor: hasMore ? String(offset + limit) : null })
  })
  .post('/', zValidator('json', z.object({ receipts: z.array(z.string().max(3000)).max(200) })), (c) => {
    const userId = c.get('userId')
    const result = applyReceipts(c.req.valid('json').receipts)
    const u = db.prepare('SELECT id, card_id, card_code, nickname, invite_code, cashback_balance FROM users WHERE id=?')
      .get(userId) as { id: number; card_id: string; card_code: string; nickname: string; invite_code: string; cashback_balance: number }
    return c.json({
      card: buildCardProof(userId),
      me: { id: u.id, cardId: u.card_id, cardCode: u.card_code, nickname: u.nickname, inviteCode: u.invite_code, cashbackBalance: u.cashback_balance, ...stateView(userId), vouchers: activeVouchers(userId) },
      result,
    })
  })
