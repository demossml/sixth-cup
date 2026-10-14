export type GameStatus =
  | 'intro'
  | 'loading'
  | 'ready' // сцена готова, ждёт старта (подсказка первого забега)
  | 'playing'
  | 'paused'
  | 'won'
  | 'lost'
  | 'error'

export type AlpacaState = 'running' | 'jumping' | 'sliding' | 'hit' | 'finished'

export type GameAction = 'jump' | 'slide' | 'pause'

export type LevelObject =
  | { type: 'bean'; id: string; x: number; y: number }
  /** Ящик/платформа: на неё можно запрыгнуть (landable по умолчанию). width кратен crateUnit. */
  | { type: 'crate'; id: string; x: number; width: number; height: number; landable?: boolean }
  /** Баннер: висит от верха экрана до просвета над землёй, проходится только скольжением. */
  | { type: 'overhead'; id: string; x: number; width: number; height: number }
  | { type: 'finish'; id: string; x: number }

export interface RunnerRunResult {
  runId: string
  levelId: string
  beansCollected: number
  durationMs: number
  completed: boolean
}

export interface RunnerProgress {
  levelId: string
  completedRuns: number
  bestBeans: number
  bestDurationMs: number | null
  updatedAt: string
}

export interface GameHudSnapshot {
  beans: number
  beansTotal: number
  progress01: number
  levelName: string
}

export interface GameBridge {
  onStatus: (s: GameStatus) => void
  onHud: (h: GameHudSnapshot) => void
  onRunEnd: (r: RunnerRunResult) => void
  /** Сцена создана — можно управлять (старт/пауза/рестарт). */
  onScene?: (scene: import('./scenes/RunnerScene').RunnerScene) => void
}
