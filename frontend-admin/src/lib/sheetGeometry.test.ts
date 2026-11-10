import { describe, expect, it } from 'vitest'
import { SHEET_SAFE, ptToWidthPct, safeAreaStyle, safeBoxSize } from './sheetGeometry'

/**
 * Геометрия листа должна совпадать с backend (`backend/src/modules/admin/sheetGeometry.ts`):
 * если меняешь поля — меняй оба файла и оба теста.
 */
describe('геометрия листа', () => {
  it('поля — доли ширины листа, одинаковые на клиенте и сервере', () => {
    expect(SHEET_SAFE).toEqual({ x: 4.4, top: 4.4, bottom: 6 })
  })

  it('безопасная область задаётся в cqw (1 cqw = 1 % ширины листа)', () => {
    expect(safeAreaStyle.left).toBe('4.4cqw')
    expect(safeAreaStyle.right).toBe('4.4cqw')
    expect(safeAreaStyle.top).toBe('4.4cqw')
    expect(safeAreaStyle.bottom).toBe('6cqw')
    expect(safeAreaStyle.position).toBe('absolute')
  })

  it('кегль переводится в процент ширины так же, как в PDF', () => {
    // 12 pt на A4 (595.28 pt) = 2.016 % ширины листа
    expect(ptToWidthPct(12)).toBeCloseTo(2.016, 3)
    expect(ptToWidthPct(595.28)).toBeCloseTo(100, 5)
    // одинаковый кегль одинаково выглядит на A4 и A3: доля ширины не зависит от формата
    expect(ptToWidthPct(10)).toBeCloseTo(1.68, 2)
  })

  it('размер безопасной области для жестов считается по рамке листа', () => {
    const sheet = { width: 560, height: 792 } // A4 при 560 px
    const safe = safeBoxSize(sheet)
    expect(safe.w).toBeCloseTo(560 * (1 - 0.088), 5)
    expect(safe.h).toBeCloseTo(792 - 560 * (0.044 + 0.06), 5)
    expect(safe.w).toBeLessThan(sheet.width)
    expect(safe.h).toBeLessThan(sheet.height)
  })
})
