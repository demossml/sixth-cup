import { getJwt } from '../api'

async function gameFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const t = getJwt()
  const res = await fetch(`/api/game${path}`, {
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

export const gameApi = {
  status: () => gameFetch<{ rewardsLeftToday: number; rewardByStage: Record<string, number> }>('/status'),
  start: () =>
    gameFetch<{ sessionId: string; expiresAt: number; rewardsLeftToday: number }>('/start', {
      method: 'POST',
      body: '{}',
    }),
  claim: (body: {
    sessionId: string
    stageReached: number
    won: boolean
    clientNonce: string
    durationMs?: number
  }) =>
    gameFetch<{ rewardKop: number; message: string; rewardsLeftToday: number; alreadyClaimed?: boolean }>(
      '/claim',
      { method: 'POST', body: JSON.stringify(body) },
    ),
}
