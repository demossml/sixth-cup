/** Multi-level alpaca runner API. Stats/progression only: this module never awards cashback or cups. */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { requireAuth, type AuthEnv } from '../../middleware/auth'

const MAX_DURATION_MS = 600_000
const LEVELS = [
  { id: 'morning-coffee-city-01', name: 'Утро в городе', beans: 18, length: 5000 },
  { id: 'alley-rush-02', name: 'Переулок', beans: 19, length: 6000 },
  { id: 'terrace-wind-03', name: 'Терраса', beans: 15, length: 6700 },
  { id: 'night-shift-04', name: 'Ночная смена', beans: 13, length: 7400 },
] as const
const LEVEL_BY_ID = new Map<string, (typeof LEVELS)[number] & { index: number }>(LEVELS.map((l, i) => [l.id, { ...l, index: i }] as const))
type ProgressRow = { levelId: string; completedRuns: number; bestBeans: number; bestDurationMs: number | null; updatedAt: number; stars: number }

function progressFor(userId: number, levelId: string): ProgressRow | undefined {
  return db.prepare(`SELECT level_id AS levelId, completed_runs AS completedRuns, best_beans AS bestBeans,
      best_duration_ms AS bestDurationMs, updated_at AS updatedAt, stars
    FROM runner_progress WHERE user_id=? AND level_id=?`).get(userId, levelId) as ProgressRow | undefined
}
function allProgress(userId: number) {
  const rows = db.prepare(`SELECT level_id AS levelId, completed_runs AS completedRuns, best_beans AS bestBeans,
    best_duration_ms AS bestDurationMs, updated_at AS updatedAt, stars FROM runner_progress WHERE user_id=?`).all(userId) as ProgressRow[]
  const byId = new Map(rows.map(r => [r.levelId, r]))
  return LEVELS.map((level, index) => {
    const row = byId.get(level.id)
    const unlocked = index === 0 || (byId.get(LEVELS[index - 1].id)?.completedRuns ?? 0) > 0
    return { levelId: level.id, name: level.name, beansTotal: level.beans, unlocked,
      completedRuns: row?.completedRuns ?? 0, bestBeans: row?.bestBeans ?? 0,
      bestDurationMs: row?.bestDurationMs ?? null, stars: row?.stars ?? 0,
      updatedAt: row ? new Date(row.updatedAt).toISOString() : new Date(0).toISOString() }
  })
}

export const runnerRoutes = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/meta', (c) => {
    const userId = c.get('userId')
    const recentRuns = db.prepare(`SELECT level_id AS levelId, beans_collected AS beansCollected, duration_ms AS durationMs,
      completed, created_at AS createdAt FROM runner_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 5`).all(userId) as
      { levelId: string; beansCollected: number; durationMs: number; completed: number; createdAt: number }[]
    const completedDays = new Set((db.prepare(`SELECT DISTINCT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day
      FROM runner_runs WHERE user_id=? AND completed=1`).all(userId) as { day: string }[]).map(r => r.day))
    const today = new Date(); today.setUTCHours(0, 0, 0, 0)
    if (!completedDays.has(today.toISOString().slice(0, 10))) today.setUTCDate(today.getUTCDate() - 1)
    let streakDays = 0
    for (let cursor = today.getTime(); completedDays.has(new Date(cursor).toISOString().slice(0, 10)); cursor -= 86_400_000) streakDays++
    return c.json({ ok: true, levels: allProgress(userId), streakDays, recentRuns: recentRuns.map(r => ({ ...r, completed: !!r.completed,
      levelName: LEVEL_BY_ID.get(r.levelId)?.name ?? r.levelId, createdAt: new Date(r.createdAt).toISOString() })), rewardsEnabled: false,
      message: 'Прогресс, звёзды и разблокировка — игровые достижения; кэшбэк и чашки не начисляются.' })
  })
  .get('/progress', (c) => {
    const userId = c.get('userId')
    const row = progressFor(userId, LEVELS[0].id)
    return c.json({ ok: true, progress: {
      levelId: LEVELS[0].id, completedRuns: row?.completedRuns ?? 0, bestBeans: row?.bestBeans ?? 0,
      bestDurationMs: row?.bestDurationMs ?? null, stars: row?.stars ?? 0,
      updatedAt: row ? new Date(row.updatedAt).toISOString() : new Date(0).toISOString(),
    } })
  })
  .post('/runs', zValidator('json', z.object({
    runId: z.string().uuid(), levelId: z.string().min(1).max(80),
    beansCollected: z.number().int().min(0).max(30), durationMs: z.number().int().min(1).max(MAX_DURATION_MS),
    completed: z.boolean(),
  })), (c) => {
    const userId = c.get('userId')
    const body = c.req.valid('json')
    const level = LEVEL_BY_ID.get(body.levelId)
    if (!level) throw bad('Неизвестный уровень', 400)
    if (body.beansCollected > level.beans) throw bad('Слишком много зёрен для этого уровня', 400)
    // Basic speed plausibility; allow a generous margin for gameplay and device timing differences.
    if (body.completed && body.durationMs < Math.floor((level.length / 310) * 650)) throw bad('Результат получен слишком быстро', 400)
    const levels = allProgress(userId)
    const meta = levels[level.index]
    if (!meta.unlocked) throw bad('Сначала пройдите предыдущий уровень', 409)
    const now = Date.now()
    const existing = db.prepare('SELECT user_id AS userId, level_id AS levelId FROM runner_runs WHERE run_id=?').get(body.runId) as { userId: number; levelId: string } | undefined
    if (existing) {
      if (existing.userId !== userId || existing.levelId !== body.levelId) throw bad('runId уже использован', 409)
      const row = progressFor(userId, body.levelId)
      return c.json({ ok: true, duplicate: true, runId: body.runId, progress: {
        completedRuns: row?.completedRuns ?? 0, bestBeans: row?.bestBeans ?? 0,
        bestDurationMs: row?.bestDurationMs ?? null, stars: row?.stars ?? 0,
      } })
    }
    const stars = body.completed ? (body.beansCollected >= level.beans ? 3 : body.beansCollected >= Math.ceil(level.beans * 0.7) ? 2 : 1) : 0
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO runner_runs(run_id,user_id,level_id,beans_collected,duration_ms,completed,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(body.runId, userId, body.levelId, body.beansCollected, body.durationMs, body.completed ? 1 : 0, now)
      const prev = progressFor(userId, body.levelId)
      const completedRuns = (prev?.completedRuns ?? 0) + (body.completed ? 1 : 0)
      const bestBeans = Math.max(prev?.bestBeans ?? 0, body.beansCollected)
      const bestDurationMs = body.completed ? (prev?.bestDurationMs == null ? body.durationMs : Math.min(prev.bestDurationMs, body.durationMs)) : (prev?.bestDurationMs ?? null)
      const bestStars = Math.max(prev?.stars ?? 0, stars)
      db.prepare(`INSERT INTO runner_progress(user_id,level_id,completed_runs,best_beans,best_duration_ms,updated_at,stars)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,level_id) DO UPDATE SET
        completed_runs=excluded.completed_runs,best_beans=excluded.best_beans,best_duration_ms=excluded.best_duration_ms,
        updated_at=excluded.updated_at,stars=excluded.stars`)
        .run(userId, body.levelId, completedRuns, bestBeans, bestDurationMs, now, bestStars)
      return { completedRuns, bestBeans, bestDurationMs, stars: bestStars }
    })
    const progress = tx()
    return c.json({ ok: true, duplicate: false, runId: body.runId, starsEarned: stars, progress, levels: allProgress(userId) })
  })
