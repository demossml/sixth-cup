import type { AlpacaState } from '../types'
import { RUNNER_CONFIG } from '../config'

/** Jump height offset for given elapsed ms (TZ §23.2). */
export function jumpOffsetY(elapsedMs: number): number {
  const progress = Math.min(1, elapsedMs / RUNNER_CONFIG.jumpDurationMs)
  return RUNNER_CONFIG.jumpHeight * 4 * progress * (1 - progress)
}

export function canStartJump(state: AlpacaState): boolean {
  return state === 'running'
}

export function canStartSlide(state: AlpacaState): boolean {
  return state === 'running'
}
