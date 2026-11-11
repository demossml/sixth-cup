import { describe, expect, it } from 'vitest'
import { expectedMm, isMatch, pageMm, previewBadge, sizeDiffMm } from './printPreview'

describe('P3-6: «как в печати» — размеры страницы PDF', () => {
  it('A4 в пунктах переводится в миллиметры', () => {
    // A4 = 595,28 × 841,89 pt.
    const mm = pageMm(595.28, 841.89)
    expect(mm.width).toBeCloseTo(210, 0)
    expect(mm.height).toBeCloseTo(297, 0)
  })

  it('ожидаемый размер берётся из формата листа', () => {
    expect(expectedMm('a4_portrait')).toEqual({ width: 210, height: 297 })
    expect(expectedMm('a3_portrait')).toEqual({ width: 297, height: 420 })
    expect(expectedMm('a5_portrait')).toEqual({ width: 148, height: 210 })
  })

  it('расхождение ≤ 1 мм — критерий приёмки', () => {
    const pdf = pageMm(595.28, 841.89)
    expect(sizeDiffMm(pdf, expectedMm('a4_portrait'))).toBeLessThanOrEqual(1)
    expect(isMatch(pdf, expectedMm('a4_portrait'))).toBe(true)
    // Тот же PDF против A5 — очевидно не совпадает.
    expect(isMatch(pdf, expectedMm('a5_portrait'))).toBe(false)
  })

  it('бейдж говорит словами, где расхождение', () => {
    expect(previewBadge({ width: 210, height: 297 }, { width: 210, height: 297 })).toContain('совпадает')
    expect(previewBadge({ width: 210, height: 300 }, { width: 210, height: 297 })).toContain('расхождение 3,0 мм')
  })
})
