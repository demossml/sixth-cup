import { describe, expect, it } from 'vitest'
import { newBlock, type MenuBlock } from './menuLayout'
import {
  alignBlocks,
  clampZoom,
  distributeBlocks,
  fitZoom,
  groupKeyOf,
  rectsIntersect,
  snapWithGuides,
  zoomStep,
} from './menuTools'

const block = (id: string, x: number, y: number, w = 20, h = 6, extra: Partial<MenuBlock> = {}): MenuBlock => ({
  ...newBlock('text', { xPct: x, yPct: y, wPct: w, hPct: h }, { id }),
  ...extra,
})

describe('выравнивание выделения', () => {
  const blocks = [block('a', 0, 0), block('b', 30, 20), block('c', 10, 40)]

  it('по левому краю ставит всех в минимум', () => {
    const out = alignBlocks(blocks, ['a', 'b', 'c'], 'left')
    expect(out.map((b) => b.xPct)).toEqual([0, 0, 0])
  })

  it('по правому краю выравнивает правые границы', () => {
    const out = alignBlocks(blocks, ['a', 'b', 'c'], 'right')
    const rights = out.map((b) => b.xPct + b.wPct)
    expect(new Set(rights).size).toBe(1)
  })

  it('по центру ставит середины на одну линию', () => {
    const out = alignBlocks(blocks, ['a', 'b', 'c'], 'center')
    const centers = out.map((b) => b.xPct + b.wPct / 2)
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(0.001)
  })

  it('заблокированный блок не двигается', () => {
    const withLock = [block('a', 0, 0), block('b', 30, 20, 20, 6, { locked: true })]
    const out = alignBlocks(withLock, ['a', 'b'], 'left')
    expect(out.find((b) => b.id === 'b')!.xPct).toBe(30)
  })
})

describe('распределение промежутков', () => {
  it('делает равные зазоры между тремя блоками', () => {
    const blocks = [block('a', 0, 0, 10), block('b', 12, 0, 10), block('c', 60, 0, 10)]
    const out = distributeBlocks(blocks, ['a', 'b', 'c'], 'x')
    const sorted = [...out].sort((p, q) => p.xPct - q.xPct)
    const gap1 = sorted[1]!.xPct - (sorted[0]!.xPct + sorted[0]!.wPct)
    const gap2 = sorted[2]!.xPct - (sorted[1]!.xPct + sorted[1]!.wPct)
    expect(Math.abs(gap1 - gap2)).toBeLessThan(0.001)
  })

  it('на двух блоках ничего не делает', () => {
    const blocks = [block('a', 0, 0), block('b', 30, 0)]
    expect(distributeBlocks(blocks, ['a', 'b'], 'x')).toEqual(blocks)
  })
})

describe('рамка выделения', () => {
  it('пересечение и непересечение', () => {
    expect(rectsIntersect({ xPct: 0, yPct: 0, wPct: 10, hPct: 10 }, { xPct: 5, yPct: 5, wPct: 10, hPct: 10 })).toBe(true)
    expect(rectsIntersect({ xPct: 0, yPct: 0, wPct: 10, hPct: 10 }, { xPct: 20, yPct: 20, wPct: 5, hPct: 5 })).toBe(false)
  })
})

describe('направляющие прилипания', () => {
  it('центр листа даёт направляющую на 50 %', () => {
    const shot = snapWithGuides({ xPct: 40.3, yPct: 10, wPct: 20, hPct: 6 }, [], 0.8)
    expect(shot.rect.xPct).toBe(40)
    expect(shot.guides.x).toContain(50)
  })

  it('край соседнего блока притягивает и показывает линию', () => {
    const other = { xPct: 30, yPct: 0, wPct: 20, hPct: 6 }
    const shot = snapWithGuides({ xPct: 30.4, yPct: 20, wPct: 20, hPct: 6 }, [other], 0.8)
    // Блок встаёт так, чтобы его центр совпал с центром соседа (40 %), линия — по центру соседа.
    expect(shot.rect.xPct).toBe(30)
    expect(shot.guides.x).toContain(40)
  })

  it('без соседей и вдали от краёв направляющих нет', () => {
    const shot = snapWithGuides({ xPct: 17.3, yPct: 23.3, wPct: 10, hPct: 5 }, [], 0.5)
    expect(shot.guides.x).toHaveLength(0)
    expect(shot.guides.y).toHaveLength(0)
  })
})

describe('зум', () => {
  it('держит диапазон 25–400 %', () => {
    expect(clampZoom(0.01)).toBe(0.25)
    expect(clampZoom(9)).toBe(4)
    expect(clampZoom(1.234)).toBe(1.23)
  })

  it('шаг растёт вместе с масштабом', () => {
    expect(zoomStep(1, 1)).toBeCloseTo(1.1)
    expect(zoomStep(2, 1)).toBeCloseTo(2.25)
  })

  it('«вписать» не превышает 100 % и учитывает пропорции', () => {
    expect(fitZoom(560, 10000, 210 / 297, 560)).toBeGreaterThan(0.9)
    expect(fitZoom(280, 400, 210 / 297, 560)).toBeLessThan(0.5)
  })
})

describe('группа объёмов', () => {
  it('ключом служит groupId, если он есть', () => {
    expect(groupKeyOf({ id: 5, groupId: 2 })).toBe(2)
    expect(groupKeyOf({ id: 5, groupId: null })).toBe(5)
  })
})
