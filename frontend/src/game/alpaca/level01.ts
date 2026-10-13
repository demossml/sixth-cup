import type { LevelObject } from './types'
import { RUNNER_CONFIG } from './config'

/** Fixed level «Утренний кофейный город». Coordinates in world pixels. */
export const LEVEL_01_OBJECTS: LevelObject[] = [
  // Safe beans
  { type: 'bean', id: 'b1', x: 500, y: RUNNER_CONFIG.groundY - 40 },
  { type: 'bean', id: 'b2', x: 620, y: RUNNER_CONFIG.groundY - 40 },
  { type: 'bean', id: 'b3', x: 740, y: RUNNER_CONFIG.groundY - 40 },
  // First crate (jump)
  { type: 'crate', id: 'c1', x: 980, width: 56, height: 56 },
  // Beans on jump arc
  { type: 'bean', id: 'b4', x: 1000, y: RUNNER_CONFIG.groundY - 140 },
  { type: 'bean', id: 'b5', x: 1080, y: RUNNER_CONFIG.groundY - 150 },
  // Second crate
  { type: 'crate', id: 'c2', x: 1400, width: 56, height: 64 },
  { type: 'bean', id: 'b6', x: 1420, y: RUNNER_CONFIG.groundY - 150 },
  // Overhead (slide)
  { type: 'overhead', id: 'o1', x: 1750, width: 120, height: 36 },
  { type: 'bean', id: 'b7', x: 1780, y: RUNNER_CONFIG.groundY - 30 },
  // Combo stretch
  { type: 'crate', id: 'c3', x: 2100, width: 50, height: 50 },
  { type: 'bean', id: 'b8', x: 2120, y: RUNNER_CONFIG.groundY - 130 },
  { type: 'overhead', id: 'o2', x: 2450, width: 100, height: 36 },
  { type: 'bean', id: 'b9', x: 2480, y: RUNNER_CONFIG.groundY - 28 },
  { type: 'crate', id: 'c4', x: 2800, width: 60, height: 58 },
  { type: 'bean', id: 'b10', x: 2820, y: RUNNER_CONFIG.groundY - 145 },
  // Safe finish approach
  { type: 'bean', id: 'b11', x: 3200, y: RUNNER_CONFIG.groundY - 40 },
  { type: 'bean', id: 'b12', x: 3350, y: RUNNER_CONFIG.groundY - 40 },
  { type: 'finish', id: 'finish', x: 3600 },
]

export const LEVEL_01_LENGTH = 3800
export const LEVEL_01_NAME = 'Утренний кофейный город'
export const LEVEL_01_BEAN_COUNT = LEVEL_01_OBJECTS.filter((o) => o.type === 'bean').length
