/**
 * 2D runner progress API — statistics only, never awards cashback/cups/vouchers.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { requireAuth, type AuthEnv } from '../../middleware/auth'

const LEVEL_ID = 'morning-coffee-city-01'
const MAX_BEANS = 12
const MAX_DURATION_MS = 600_000

export const runnerRoutes = new Hono<AuthEnv>()
  .use('*', requireAuth)

  .get('/progress', (c) => {
    const userId = c.get('userId')
    const row = db
      .prepare(
        `SELECT level_id AS levelId, completed_runs AS completedRuns, best_beans AS bestBeans,
                best_duration_ms AS bestDurationMs, updated_at AS updatedAt
         FROM runner_progress WHERE user_id=? AND level_id=?`,
      )
      .get(userId, LEVEL_ID) as
      | {
          levelId: string
          completedRuns: number
          bestBeans: number
          bestDurationMs: number | null
          updatedAt: number
        }
      | undefined

    return c.json({
      ok: true,
      progress: {
        levelId: LEVEL_ID,
        completedRuns: row?.completedRuns ?? 0,
        bestBeans: row?.bestBeans ?? 0,
        bestDurationMs: row?.bestDurationMs ?? null,
        updatedAt: row ? new Date(row.updatedAt).toISOString() : new Date(0).toISOString(),
      },
    })
  })

  .post(
    '/runs',
    zValidator(
      'json',
      z.object({
        runId: z.string().uuid(),
        levelId: z.literal(LEVEL_ID),
        beansCollected: z.number().int().min(0).max(MAX_BEANS),
        durationMs: z.number().int().min(1).max(MAX_DURATION_MS),
        completed: z.boolean(),
      }),
    ),
    (c) => {
      const userId = c.get('userId')
      const body = c.req.valid('json')
      const now = Date.now()

      const existing = db.prepare('SELECT run_id FROM runner_runs WHERE run_id=?').get(body.runId)
      if (existing) {
        const row = db
          .prepare(
            `SELECT completed_runs AS completedRuns, best_beans AS bestBeans, best_duration_ms AS bestDurationMs, updated_at AS updatedAt
             FROM runner_progress WHERE user_id=? AND level_id=?`,
          )
          .get(userId, LEVEL_ID) as
          | { completedRuns: number; bestBeans: number; bestDurationMs: number | null; updatedAt: number }
          | undefined
        return c.json({
          ok: true,
          runId: body.runId,
          progress: {
            completedRuns: row?.completedRuns ?? 0,
            bestBeans: row?.bestBeans ?? 0,
            bestDurationMs: row?.bestDurationMs ?? null,
          },
        })
      }

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO runner_runs(run_id, user_id, level_id, beans_collected, duration_ms, completed, created_at)
           VALUES(?,?,?,?,?,?,?)`,
        ).run(
          body.runId,
          userId,
          body.levelId,
          body.beansCollected,
          body.durationMs,
          body.completed ? 1 : 0,
          now,
        )

        const prev = db
          .prepare(
            `SELECT completed_runs AS completedRuns, best_beans AS bestBeans, best_duration_ms AS bestDurationMs
             FROM runner_progress WHERE user_id=? AND level_id=?`,
          )
          .get(userId, LEVEL_ID) as
          | { completedRuns: number; bestBeans: number; bestDurationMs: number | null }
          | undefined

        const completedRuns = (prev?.completedRuns ?? 0) + (body.completed ? 1 : 0)
        const bestBeans = Math.max(prev?.bestBeans ?? 0, body.beansCollected)
        let bestDuration = prev?.bestDurationMs ?? null
        if (body.completed) {
          bestDuration =
            bestDuration == null ? body.durationMs : Math.min(bestDuration, body.durationMs)
        }

        db.prepare(
          `INSERT INTO runner_progress(user_id, level_id, completed_runs, best_beans, best_duration_ms, updated_at)
           VALUES(?,?,?,?,?,?)
           ON CONFLICT(user_id, level_id) DO UPDATE SET
             completed_runs=excluded.completed_runs,
             best_beans=excluded.best_beans,
             best_duration_ms=excluded.best_duration_ms,
             updated_at=excluded.updated_at`,
        ).run(userId, LEVEL_ID, completedRuns, bestBeans, bestDuration, now)

        return { completedRuns, bestBeans, bestDurationMs: bestDuration }
      })

      const progress = tx()
      return c.json({ ok: true, runId: body.runId, progress })
    },
  )
