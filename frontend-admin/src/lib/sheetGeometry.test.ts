import { describe, expect, it } from 'vitest'
import {
  SHEET_SAFE,
  mmToPct,
  pctToMm,
  ptToWidthPct,
  safeAreaStyle,
  safeBoxSize,
  safeMm,
  sheetMm,
} from './sheetGeometry'

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

  it('миллиметры считаются по id формата: A4 и A5 не путаются', () => {
    expect(sheetMm('a4_portrait')).toEqual({ width: 210, height: 297 })
    expect(sheetMm('a5_portrait')).toEqual({ width: 148, height: 210 })
    expect(sheetMm('a4_landscape')).toEqual({ width: 297, height: 210 })
    // у экрана нет физического размера — миллиметры не выдумываем
    expect(sheetMm('screen_16_9')).toBeNull()

    const safe = safeMm('a4_portrait')!
    expect(safe.width).toBeCloseTo(210 * (1 - 0.088), 5)
    expect(safe.height).toBeCloseTo(297 - 210 * (0.044 + 0.06), 5)
  })

  it('проценты и миллиметры переводятся туда и обратно', () => {
    const safe = safeMm('a4_portrait')!
    const rect = { xPct: 12.5, yPct: 30, wPct: 40, hPct: 7.5 }
    const mm = pctToMm(rect, 'a4_portrait')!
    expect(mm.x).toBeCloseTo(safe.left + (rect.xPct / 100) * safe.width, 1)
    expect(mm.y).toBeCloseTo(safe.top + (rect.yPct / 100) * safe.height, 1)
    expect(mm.w).toBeCloseTo((rect.wPct / 100) * safe.width, 1)
    expect(mm.h).toBeCloseTo((rect.hPct / 100) * safe.height, 1)

    // обратный перевод: расхождение только от округления до 0,1 мм
    const back = mmToPct(mm, 'a4_portrait')!
    expect(back.xPct).toBeCloseTo(rect.xPct, 1)
    expect(back.yPct).toBeCloseTo(rect.yPct, 1)
    expect(back.wPct).toBeCloseTo(rect.wPct, 1)
    expect(back.hPct).toBeCloseTo(rect.hPct, 1)
    expect(pctToMm(rect, 'screen_16_9')).toBeNull()
  })
})
