import { RUNNER_CONFIG } from '../config'

/** Кадры spritesheet `alpaca` (кадр 192×192, лист 5×2). Генерируется scripts/make-alpaca-assets.mjs. */
export const ALPACA_FRAMES = {
  run: [0, 1, 2, 3],
  hit: 4,
  jumpUp: 5,
  jumpDown: 6,
  slide: [7, 8],
} as const

export const ALPACA_FRAME_SIZE = 192
/** Мировой размер кадра = 96 px (текстура 2x). */
export const ALPACA_SCALE = 0.5
/** Точка опоры в кадре: x — центр туловища, y — линия ступней. */
export const ALPACA_ORIGIN = { x: 88 / ALPACA_FRAME_SIZE, y: 184 / ALPACA_FRAME_SIZE }

/** Рамка hitbox для отладки: экранные координаты по ступням героя. */
export function heroDebugRect(bottom: number, kind: keyof typeof RUNNER_CONFIG.hitbox) {
  const hb = RUNNER_CONFIG.hitbox[kind]
  const cx = RUNNER_CONFIG.heroX + hb.offsetX
  return { x: cx - hb.w / 2, y: bottom - hb.h, w: hb.w, h: hb.h }
}
