/**
 * Alpaca mini-game: start session online, play offline, claim reward only on server.
 * Max 1 cashback reward per calendar day (UTC) per user.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { requireAuth, type AuthEnv } from '../../middleware/auth'

const DAY_MS = 86_400_000
const SESSION_TTL_MS = DAY_MS
/** One successful reward claim per UTC day. */
const MAX_REWARDS_PER_DAY = 1
/** Stage → cashback kopecks (0 = fun only). */
const REWARD_BY_STAGE: Record<number, number> = {
  1: 0,
  2: 30,
  3: 50,
}

function utcDay(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10)
}

function rewardsToday(userId: number): number {
  const day = utcDay()
  const row = db.prepare('SELECT rewards FROM game_daily WHERE user_id=? AND day=?').get(userId, day) as
    | { rewards: number }
    | undefined
  return row?.rewards ?? 0
}

export const gameRoutes = new Hono<AuthEnv>()
  .use('*', requireAuth)

  .get('/status', (c) => {
    const userId = c.get('userId')
    const used = rewardsToday(userId)
    return c.json({
      ok: true,
      rewardsUsedToday: used,
      rewardsLeftToday: Math.max(0, MAX_REWARDS_PER_DAY - used),
      maxRewardsPerDay: MAX_REWARDS_PER_DAY,
      rewardByStage: REWARD_BY_STAGE,
    })
  })

  .post('/start', (c) => {
    const userId = c.get('userId')
    const now = Date.now()
    const sessionId = randomBytes(16).toString('hex')
    const expiresAt = now + SESSION_TTL_MS
    db.prepare(
      `INSERT INTO game_sessions(session_id, user_id, created_at, expires_at, stage_reached, reward_kop)
       VALUES(?,?,?,?,0,0)`,
    ).run(sessionId, userId, now, expiresAt)
    return c.json({
      ok: true,
      sessionId,
      expiresAt,
      rewardsLeftToday: Math.max(0, MAX_REWARDS_PER_DAY - rewardsToday(userId)),
      rewardByStage: REWARD_BY_STAGE,
    })
  })

  .post(
    '/claim',
    zValidator(
      'json',
      z.object({
        sessionId: z.string().min(16).max(64),
        stageReached: z.number().int().min(0).max(3),
        won: z.boolean(),
        clientNonce: z.string().min(8).max(64),
        durationMs: z.number().int().min(0).max(600_000).optional(),
      }),
    ),
    (c) => {
      const userId = c.get('userId')
      const body = c.req.valid('json')
      const now = Date.now()

      const session = db
        .prepare(
          `SELECT session_id AS sessionId, user_id AS userId, expires_at AS expiresAt,
                  claimed_at AS claimedAt, stage_reached AS stageReached, reward_kop AS rewardKop
           FROM game_sessions WHERE session_id=?`,
        )
        .get(body.sessionId) as
        | {
            sessionId: string
            userId: number
            expiresAt: number
            claimedAt: number | null
            stageReached: number
            rewardKop: number
          }
        | undefined

      if (!session || session.userId !== userId) throw bad('Сессия игры не найдена', 404)
      if (session.expiresAt < now) throw bad('Сессия игры истекла', 409)

      // Idempotent: same session already claimed
      if (session.claimedAt) {
        return c.json({
          ok: true,
          alreadyClaimed: true,
          rewardKop: session.rewardKop,
          rewardsLeftToday: Math.max(0, MAX_REWARDS_PER_DAY - rewardsToday(userId)),
        })
      }

      // Anti-bot: too fast for a real stage clear
      if (body.won && body.stageReached >= 2 && (body.durationMs ?? 0) < 4_000) {
        throw bad('Слишком быстро для этого этапа', 400)
      }

      let rewardKop = 0
      if (body.won && body.stageReached >= 1) {
        rewardKop = REWARD_BY_STAGE[body.stageReached] ?? 0
      }

      const day = utcDay(now)
      const used = rewardsToday(userId)
      if (rewardKop > 0 && used >= MAX_REWARDS_PER_DAY) {
        rewardKop = 0
      }

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE game_sessions
           SET claimed_at=?, stage_reached=?, reward_kop=?, client_nonce=?
           WHERE session_id=? AND claimed_at IS NULL`,
        ).run(now, body.stageReached, rewardKop, body.clientNonce, body.sessionId)

        if (rewardKop > 0) {
          db.prepare(
            `INSERT INTO game_daily(user_id, day, rewards) VALUES(?,?,1)
             ON CONFLICT(user_id, day) DO UPDATE SET rewards = rewards + 1`,
          ).run(userId, day)
          db.prepare(`UPDATE users SET cashback_balance = cashback_balance + ? WHERE id=?`).run(rewardKop, userId)
          // receipt_id namespace for game claims
          const receiptId = `game:${body.sessionId}`
          db.prepare(
            `INSERT INTO cashback_ledger(beneficiary_id, from_user_id, receipt_id, amount, created_at)
             VALUES(?,?,?,?,?)`,
          ).run(userId, userId, receiptId, rewardKop, now)

          const card = db.prepare('SELECT card_id FROM users WHERE id=?').get(userId) as { card_id: string } | undefined
          if (card?.card_id) {
            try {
              db.prepare(
                `INSERT INTO loyalty_ledger(card_id, operation, cups_delta, free_delta, cashback_delta, source_type, source_id, created_at)
                 VALUES(?,?,0,0,?,?,?,?)`,
              ).run(card.card_id, 'EARN', rewardKop, 'GAME', body.sessionId, now)
            } catch {
              /* ledger schema may differ slightly — cashback_balance still updated */
            }
          }
        }
      })
      tx()

      return c.json({
        ok: true,
        alreadyClaimed: false,
        rewardKop,
        stageReached: body.stageReached,
        rewardsLeftToday: Math.max(0, MAX_REWARDS_PER_DAY - rewardsToday(userId)),
        message:
          rewardKop > 0
            ? `Начислено ${(rewardKop / 100).toFixed(2)} ₽ кэшбэка`
            : body.won
              ? 'Победа! Сегодня награда уже получена или этап без бонуса'
              : 'Без награды',
      })
    },
  )
