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

export const runnerApi = {
  progress: () => req<{ ok: boolean; progress: RunnerProgress }>('/progress'),
  submitRun: (body: RunnerRunResult) =>
    req<{ ok: boolean; progress: RunnerProgress }>('/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
