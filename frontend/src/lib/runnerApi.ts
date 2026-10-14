import { getJwt } from '../api'
import type { RunnerProgress, RunnerRunResult } from '../game/alpaca/types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const t = getJwt()
  const res = await fetch(`/api/game/runner${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error || `Ошибка ${res.status}`)
  return body
}

export type RunnerLevelMeta = { levelId: string; name: string; beansTotal: number; unlocked: boolean; completedRuns: number; bestBeans: number; bestDurationMs: number | null; stars: number; updatedAt: string }

export const runnerApi = {
  progress: () => req<{ ok: boolean; progress: RunnerProgress }>('/progress'),
  meta: () => req<{ ok: boolean; levels: RunnerLevelMeta[]; streakDays: number; recentRuns: { levelId: string; levelName: string; beansCollected: number; durationMs: number; completed: boolean; createdAt: string }[]; rewardsEnabled: boolean; message: string }>('/meta'),
  submitRun: (body: RunnerRunResult) =>
    req<{ ok: boolean; progress: RunnerProgress; starsEarned?: number; duplicate?: boolean }>('/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
