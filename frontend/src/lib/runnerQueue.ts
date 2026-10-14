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

function isPermanentReject(message: string): boolean {
  return /Сначала пройдите|runId уже|слишком быстро|Максимум зёрен|Неизвестный уровень|400|409/i.test(message)
}

/** Flush queue. Permanent 4xx drops the item; network errors stop the loop. */
export async function flushRunnerQueue(
  post: (body: RunnerRunResult) => Promise<void>,
): Promise<number> {
  let n = 0
  for (const r of loadRunnerQueue()) {
    try {
      await post(r)
      dequeueRunner(r.runId)
      n++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (isPermanentReject(msg)) {
        dequeueRunner(r.runId)
        continue
      }
      break
    }
  }
  return n
}
