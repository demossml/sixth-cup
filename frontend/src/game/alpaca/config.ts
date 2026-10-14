/**
 * Все числа геймплея в одном месте. Единицы — мировые пиксели (мир 960×540) и миллисекунды.
 * Согласованность этих чисел проверяет core/RunnerCore.test.ts.
 */
export const RUNNER_CONFIG = {
  width: 960,
  height: 540,
  groundY: 430,
  heroX: 170, // экранная X центра героя (камера неподвижна, мир едет влево)

  // скорость мира: старт → +14% к финишу
  worldSpeed: 270,
  speedRamp: 0.14,

  // прыжок: высота и время полёта по ровной земле → гравитация/импульс считаются из них
  jumpHeight: 135,
  jumpAirtimeMs: 620,
  coyoteMs: 70,
  jumpBufferMs: 110,
  fastFallVy: 1100, // свайп вниз в воздухе

  // скольжение
  slideDurationMs: 550,

  // hitbox героя (px, экранные). Низ = ступни.
  hitbox: {
    run: { w: 44, h: 54, offsetX: 4 },
    jump: { w: 44, h: 50, offsetX: 4 },
    slide: { w: 66, h: 24, offsetX: 8 }, // 24/54 = 44% высоты бега
  },

  // препятствия
  crateUnit: 56, // сторона одного ящика
  bannerGap: 44, // просвет под баннером (низ ткани = groundY − gap)
  bannerWidth: 60,
  ledgeAssistPx: 14, // «прощаем» заступ на край ящика, если проникновение меньше

  swipeThresholdPx: 28,
  levelId: 'morning-coffee-city-01',
  maxDeltaMs: 50,
  stepMs: 1000 / 120, // шаг фиксированной физики

  debugHitbox: false,
} as const

export type HitboxKind = keyof typeof RUNNER_CONFIG.hitbox

/** Производные физические константы. */
export const JUMP_GRAVITY = (8 * RUNNER_CONFIG.jumpHeight) / Math.pow(RUNNER_CONFIG.jumpAirtimeMs / 1000, 2) // px/s²
export const JUMP_VELOCITY = (JUMP_GRAVITY * (RUNNER_CONFIG.jumpAirtimeMs / 1000)) / 2 // px/s вверх

/** `?debug=1` в URL включает рамки hitbox. */
export function isDebugHitbox(): boolean {
  try {
    return RUNNER_CONFIG.debugHitbox || new URLSearchParams(window.location.search).get('debug') === '1'
  } catch {
    return false
  }
}
