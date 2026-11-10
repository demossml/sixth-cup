import { describe, expect, it } from 'vitest'
import { IMPOSE_PRESETS, MM_TO_PT, SHEET_MM, imposeLabel, imposePlan, parseImpose, sheetCount } from './imposition'

const A4 = { w: 210 * MM_TO_PT, h: 297 * MM_TO_PT }

describe('спуск полос', () => {
  it('A4 вдвое на A3: лист разворачивается, страницы поворачиваются, масштаб ≈100 %', () => {
    const plan = imposePlan(A4.w, A4.h, { sheet: 'a3', rows: 2, cols: 1 })
    expect(plan.landscape).toBe(false)
    expect(plan.rotated).toBe(true)
    // 100 % не бывает: поля листа и промежуток между страницами съедают ~5 %.
    expect(plan.scale).toBeGreaterThan(0.9)
    expect(plan.cells).toHaveLength(2)
    // Две страницы одна над другой, без наложений.
    const [a, b] = plan.cells
    expect(b!.y).toBeGreaterThan(a!.y)
    expect(a!.y + a!.h).toBeLessThanOrEqual(b!.y)
  })

  it('4 страницы на A2: A2 — это ровно 4×A4, поворот не нужен', () => {
    const plan = imposePlan(A4.w, A4.h, { sheet: 'a2', rows: 2, cols: 2 })
    expect(plan.rotated).toBe(false)
    expect(plan.scale).toBeGreaterThan(0.9)
    expect(plan.cells).toHaveLength(4)
    // Лист A2 в портрете: 420×594 мм.
    expect(plan.sheetW).toBeCloseTo(SHEET_MM.a2.w * MM_TO_PT, 5)
    expect(plan.sheetH).toBeCloseTo(SHEET_MM.a2.h * MM_TO_PT, 5)
  })

  it('4 страницы на A3: уменьшение, но все страницы одного размера', () => {
    const plan = imposePlan(A4.w, A4.h, { sheet: 'a3', rows: 2, cols: 2 })
    expect(plan.cells).toHaveLength(4)
    expect(plan.scale).toBeLessThan(0.8)
    const sizes = new Set(plan.cells.map((c) => `${c.w.toFixed(2)}x${c.h.toFixed(2)}`))
    expect(sizes.size).toBe(1)
  })

  it('страницы не вылезают за лист и не пересекаются', () => {
    for (const preset of IMPOSE_PRESETS) {
      if (!preset.spec) continue
      const plan = imposePlan(A4.w, A4.h, preset.spec)
      for (const cell of plan.cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0)
        expect(cell.y).toBeGreaterThanOrEqual(0)
        expect(cell.x + cell.w).toBeLessThanOrEqual(plan.sheetW + 1e-6)
        expect(cell.y + cell.h).toBeLessThanOrEqual(plan.sheetH + 1e-6)
      }
      for (let i = 0; i < plan.cells.length; i += 1) {
        for (let j = i + 1; j < plan.cells.length; j += 1) {
          const a = plan.cells[i]!
          const b = plan.cells[j]!
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
          expect(overlapX <= 0.01 || overlapY <= 0.01).toBe(true)
        }
      }
    }
  })

  it('узкая страница не вылезает из ячейки: масштаб меньше единицы', () => {
    // A5 (148×210) на A3 2×2: ячейка A5, но с полями — уже чуть меньше.
    const plan = imposePlan(148 * MM_TO_PT, 210 * MM_TO_PT, { sheet: 'a3', rows: 2, cols: 2 })
    expect(plan.scale).toBeLessThan(1)
    expect(plan.scale).toBeGreaterThan(0.9)
  })

  it('листы считаются по числу страниц', () => {
    expect(sheetCount(1, 2, 2)).toBe(1)
    expect(sheetCount(4, 2, 2)).toBe(1)
    expect(sheetCount(5, 2, 2)).toBe(2)
    expect(sheetCount(3, 2, 1)).toBe(2)
  })

  it('подпись объясняет лист, сетку и масштаб', () => {
    const plan = imposePlan(A4.w, A4.h, { sheet: 'a3', rows: 2, cols: 2 })
    expect(imposeLabel(plan, 'A4')).toContain('A3')
    expect(imposeLabel(plan, 'A4')).toContain('2×2')
    expect(imposeLabel(plan, 'A4')).toContain('%')
  })

  it('разбор query: известные пресеты и мусор', () => {
    expect(parseImpose('a3-2')).toEqual({ sheet: 'a3', rows: 2, cols: 1 })
    expect(parseImpose('a2-4')).toEqual({ sheet: 'a2', rows: 2, cols: 2 })
    expect(parseImpose('a3-4')).toEqual({ sheet: 'a3', rows: 2, cols: 2 })
    expect(parseImpose('off')).toBeNull()
    expect(parseImpose('какой-то-мусор')).toBeNull()
    expect(parseImpose(null)).toBeNull()
  })
})
