/** Offline queue for runner stats only — never awards loyalty. */
import type { RunnerRunResult } from '../game/alpaca/types'

const KEY = 'sc_runner_pending_v1'

export function loadRunnerQueue(): RunnerRunResult[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const a = JSON.parse(raw) as RunnerRunResult[]
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

export function enqueueRunner(r: RunnerRunResult) {
  const all = loadRunnerQueue().filter((x) => x.runId !== r.runId)
  all.push(r)
  localStorage.setItem(KEY, JSON.stringify(all.slice(-30)))
}

export function dequeueRunner(runId: string) {
  localStorage.setItem(KEY, JSON.stringify(loadRunnerQueue().filter((x) => x.runId !== runId)))
}

export async function flushRunnerQueue(
  post: (body: RunnerRunResult) => Promise<void>,
): Promise<number> {
  let n = 0
  for (const r of loadRunnerQueue()) {
    try {
      await post(r)
      dequeueRunner(r.runId)
      n++
    } catch {
      break
    }
  }
  return n
}
