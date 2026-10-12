/** Offline queue for game reward claims. Rewards apply only after successful server claim. */

export type PendingClaim = {
  sessionId: string
  stageReached: number
  won: boolean
  clientNonce: string
  durationMs: number
  savedAt: number
}

const KEY = 'sc_game_pending_claims'

export function loadPendingClaims(): PendingClaim[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as PendingClaim[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function savePendingClaim(c: PendingClaim) {
  const all = loadPendingClaims().filter((x) => x.sessionId !== c.sessionId)
  all.push(c)
  localStorage.setItem(KEY, JSON.stringify(all.slice(-20)))
}

export function removePendingClaim(sessionId: string) {
  const all = loadPendingClaims().filter((x) => x.sessionId !== sessionId)
  localStorage.setItem(KEY, JSON.stringify(all))
}

export async function flushGameClaims(
  post: (path: string, body: unknown) => Promise<{ rewardKop?: number; message?: string; ok?: boolean }>,
): Promise<{ flushed: number; lastMessage?: string }> {
  const pending = loadPendingClaims()
  let flushed = 0
  let lastMessage: string | undefined
  for (const c of pending) {
    try {
      const r = await post('/game/claim', {
        sessionId: c.sessionId,
        stageReached: c.stageReached,
        won: c.won,
        clientNonce: c.clientNonce,
        durationMs: c.durationMs,
      })
      removePendingClaim(c.sessionId)
      flushed++
      lastMessage = r.message
    } catch {
      break // keep queue, retry later
    }
  }
  return { flushed, lastMessage }
}
