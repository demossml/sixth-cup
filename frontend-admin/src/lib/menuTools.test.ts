import { describe, expect, it } from 'vitest'
import { newBlock, type MenuBlock } from './menuLayout'
import {
  alignBlocks,
  fitFontSize,
  groupBlocks,
  groupSelectionIds,
  layoutColumns,
  ungroupBlocks,
  clampZoom,
  distributeBlocks,
  editorMode,
  fitZoom,
  groupKeyOf,
  rectsIntersect,
  reorderBlocks,
  snapToGrid,
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

describe('группы блоков', () => {
  it('клик по участнику группы выделяет всю группу', () => {
    const blocks = [block('a', 0, 0, 20, 6, { groupId: 'g1' }), block('b', 30, 0, 20, 6, { groupId: 'g1' }), block('c', 60, 0, 20, 6)]
    expect(groupSelectionIds(blocks, 'b')).toEqual(['a', 'b'])
    expect(groupSelectionIds(blocks, 'c')).toEqual(['c'])
  })

  it('группировка проставляет общий id, разгруппировка убирает', () => {
    const blocks = [block('a', 0, 0), block('b', 10, 0), block('c', 20, 0)]
    const grouped = groupBlocks(blocks, ['a', 'b'])
    expect(grouped.groupId).toBeTruthy()
    expect(grouped.blocks.filter((b) => b.groupId).map((b) => b.id)).toEqual(['a', 'b'])

    const cleared = ungroupBlocks(grouped.blocks, ['a', 'b'])
    expect(cleared.every((b) => !b.groupId)).toBe(true)
  })

  it('один блок не группируется', () => {
    const blocks = [block('a', 0, 0)]
    expect(groupBlocks(blocks, ['a']).groupId).toBeNull()
  })
})

describe('авто-фит текста', () => {
  it('уменьшает кегль, пока текст не влезет', () => {
    const fits = (pt: number) => pt <= 12
    expect(fitFontSize(fits, 24, 6, 0.5)).toBe(12)
  })

  it('не опускается ниже минимума', () => {
    expect(fitFontSize(() => false, 20, 6, 0.5)).toBe(6)
  })

  it('оставляет кегль, если уже помещается', () => {
    expect(fitFontSize(() => true, 18)).toBe(18)
  })
})

describe('раскладка по колонкам', () => {
  it('в две колонки: половина блоков слева, половина справа, без наложений', () => {
    const blocks = ['a', 'b', 'c', 'd'].map((id, i) => block(id, 0, i * 10, 40, 6))
    const out = layoutColumns(blocks, ['a', 'b', 'c', 'd'], 2)
    const left = out.filter((b) => b.xPct === Math.min(...out.map((x) => x.xPct)))
    expect(left).toHaveLength(2)
    const rights = new Set(out.map((b) => Math.round(b.xPct)))
    expect(rights.size).toBe(2)
    // блоки в колонке не пересекаются по вертикали
    const sorted = [...out].sort((a, b) => a.xPct - b.xPct || a.yPct - b.yPct)
    expect(sorted[1]!.yPct).toBeGreaterThanOrEqual(sorted[0]!.yPct + sorted[0]!.hPct)
  })

  it('заблокированный блок остаётся на месте', () => {
    const blocks = [block('a', 0, 0, 40, 6), block('b', 0, 10, 40, 6, { locked: true })]
    const out = layoutColumns(blocks, ['a', 'b'], 2)
    expect(out.find((b) => b.id === 'b')!.xPct).toBe(0)
  })
})

describe('сетка', () => {
  it('доводит левый верхний край до ближайшей линии шага', () => {
    const r = snapToGrid({ xPct: 12.4, yPct: 37.6, wPct: 30, hPct: 10 }, { stepPct: 5, cols: 1 })
    expect(r.xPct).toBe(10)
    expect(r.yPct).toBe(40)
    expect(r.wPct).toBe(30)
  })

  it('колонки добавляют свои границы к линиям шага', () => {
    // 3 колонки → границы 0, 33.3, 66.6, 100: значение 33 попадает на границу колонки
    const r = snapToGrid({ xPct: 33, yPct: 4, wPct: 20, hPct: 5 }, { stepPct: 5, cols: 3 })
    expect(r.xPct).toBeCloseTo(100 / 3, 2)
  })

  it('далёкое значение не дёргается и не выходит за лист', () => {
    const r = snapToGrid({ xPct: 47, yPct: 47, wPct: 10, hPct: 10 }, { stepPct: 2.5, cols: 1 })
    expect(r.xPct).toBe(47.5)
    const edge = snapToGrid({ xPct: 95, yPct: 95, wPct: 20, hPct: 20 }, { stepPct: 10, cols: 1 })
    expect(edge.xPct + edge.wPct).toBeLessThanOrEqual(100)
    expect(edge.yPct + edge.hPct).toBeLessThanOrEqual(100)
  })
})

describe('порядок слоёв', () => {
  const mk = (id: string, zIndex: number): MenuBlock => ({ ...newBlock('text'), id, zIndex })

  it('перетаскивание ставит блок на место цели и перенумеровывает слои', () => {
    const blocks = [mk('a', 0), mk('b', 1), mk('c', 2)]
    const next = reorderBlocks(blocks, 'a', 'c')
    const z = Object.fromEntries(next.map((b) => [b.id, b.zIndex]))
    // «a» перетащили на самый верх — он рисуется последним
    expect(z.a).toBe(2)
    expect(z.c).toBe(1)
    expect(z.b).toBe(0)
  })

  it('перетаскивание на себя ничего не меняет', () => {
    const blocks = [mk('a', 0), mk('b', 1)]
    expect(reorderBlocks(blocks, 'b', 'b')).toBe(blocks)
  })
})

describe('раскладка редактора', () => {
  it('ширина контейнера, а не окна: iPad с рейлом всё равно получает панели', () => {
    // 1024 окно − 244 рейла − поля ≈ 730 px: две зоны, а не мобильные вкладки
    expect(editorMode(730)).toBe('medium')
    expect(editorMode(620)).toBe('medium')
    expect(editorMode(1144)).toBe('wide')
    expect(editorMode(940)).toBe('wide')
  })

  it('узкая ширина и мусорные значения дают мобильные вкладки', () => {
    expect(editorMode(619)).toBe('narrow')
    expect(editorMode(402)).toBe('narrow')
    // отсоединённый узел меряется нулём — раскладку по нему не меняем
    expect(editorMode(0)).toBe('narrow')
    expect(editorMode(Number.NaN)).toBe('narrow')
  })
})
