import type { LevelObject } from './types'
import { RUNNER_CONFIG } from './config'

const G = RUNNER_CONFIG.groundY
const U = RUNNER_CONFIG.crateUnit

/** Центр зерна на земле (бегом/на корточках). */
const onGround = G - 42
/** Зерно над верхом ящика высотой U. */
const aboveCrate = G - U - 40

/**
 * «Утренний кофейный город». Координаты — мировые px (x — левый край объекта).
 * Герой стоит на экранной x=170, мир едет влево: объект с x появляется на экране справа.
 *
 * Ритм: учим бегу → ящик → баннер → платформа → комбо → цепочка платформ → финиш.
 * Между препятствиями ≥ 350 px (≈ 1,3 с) — успеваешь восстановиться.
 */
export const LEVEL_01_OBJECTS: LevelObject[] = [
  // 1. Обучение бегу: три зерна на земле
  { type: 'bean', id: 'b1', x: 520, y: onGround },
  { type: 'bean', id: 'b2', x: 600, y: onGround },
  { type: 'bean', id: 'b3', x: 680, y: onGround },

  // 2. Первый низкий ящик + зёрна по дуге прыжка
  { type: 'crate', id: 'c1', x: 1020, width: U, height: U },
  { type: 'bean', id: 'b4', x: 990, y: G - 100 },
  { type: 'bean', id: 'b5', x: 1048, y: G - 124 },
  { type: 'bean', id: 'b6', x: 1106, y: G - 100 },

  // 3. Первый баннер + зерно под ним (на высоте скольжения)
  { type: 'overhead', id: 'o1', x: 1540, width: RUNNER_CONFIG.bannerWidth, height: 0 },
  { type: 'bean', id: 'b7', x: 1570, y: G - 16 },

  // 4. Платформа на два ящика: запрыгни и пробеги по ней, зёрна сверху
  { type: 'crate', id: 'c2', x: 2000, width: U * 2, height: U },
  { type: 'bean', id: 'b8', x: 2030, y: aboveCrate },
  { type: 'bean', id: 'b9', x: 2084, y: aboveCrate },

  // 5. Комбо: баннер после платформы
  { type: 'overhead', id: 'o2', x: 2560, width: RUNNER_CONFIG.bannerWidth, height: 0 },
  { type: 'bean', id: 'b10', x: 2590, y: G - 16 },

  // 6. Одиночный ящик
  { type: 'crate', id: 'c3', x: 3000, width: U, height: U },
  { type: 'bean', id: 'b11', x: 3028, y: aboveCrate },

  // 7. Лестница платформ: длинная, зазор, короткая
  { type: 'crate', id: 'c4', x: 3480, width: U * 3, height: U },
  { type: 'bean', id: 'b12', x: 3510, y: aboveCrate },
  { type: 'bean', id: 'b13', x: 3564, y: aboveCrate },
  { type: 'bean', id: 'b14', x: 3618, y: aboveCrate },
  { type: 'crate', id: 'c5', x: 3800, width: U, height: U },
  { type: 'bean', id: 'b15', x: 3740, y: G - 112 },

  // 8. Последний баннер
  { type: 'overhead', id: 'o3', x: 4260, width: RUNNER_CONFIG.bannerWidth, height: 0 },
  { type: 'bean', id: 'b16', x: 4290, y: G - 16 },

  // 9. Безопасная дорога к финишу (≈ 600 px) и арка кофейни
  { type: 'bean', id: 'b17', x: 4620, y: onGround },
  { type: 'bean', id: 'b18', x: 4700, y: onGround },
  { type: 'finish', id: 'finish', x: 5000 },
]

/** Ширина арки (мировые px); финиш засчитывается при пересечении её середины. */
export const FINISH_WIDTH = 150
export const LEVEL_01_NAME = 'Утренний кофейный город'
export const LEVEL_01_BEAN_COUNT = LEVEL_01_OBJECTS.filter((o) => o.type === 'bean').length
export const LEVEL_01_FINISH_X = (LEVEL_01_OBJECTS.find((o) => o.type === 'finish') as { x: number }).x
/** Пройденное мировое расстояние (worldX), при котором герой пересекает середину арки. */
export const LEVEL_01_LENGTH = LEVEL_01_FINISH_X + FINISH_WIDTH / 2 - RUNNER_CONFIG.heroX
