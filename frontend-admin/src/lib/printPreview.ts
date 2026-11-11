/**
 * P3-6: «показать как в печати».
 *
 * Сравнение идёт по настоящему PDF: клиент рендерит первую страницу через pdf.js
 * и накладывает её на живой холст. Здесь — арифметика, которую можно проверить тестами:
 * размер страницы PDF в миллиметрах и расхождение с форматом листа.
 */
import { sheetMm } from './sheetGeometry'
import type { LayoutFormat } from './menuLayout'

type Mm = { width: number; height: number }

const PT_TO_MM = 25.4 / 72

/** Размер страницы PDF (pt) в миллиметрах — так, как его увидит типография. */
export const pageMm = (widthPt: number, heightPt: number): Mm => ({
  width: Math.round(widthPt * PT_TO_MM * 10) / 10,
  height: Math.round(heightPt * PT_TO_MM * 10) / 10,
})

/** Ожидаемый размер листа формата — из тех же данных, что использует редактор. */
export const expectedMm = (format: LayoutFormat): Mm => sheetMm(format) ?? { width: 210, height: 297 }

/**
 * Максимальное расхождение сторон, мм. Критерий приёмки P3-6 — не больше 1 мм:
 * больше значит, что превью и PDF считают геометрию по-разному.
 */
export const sizeDiffMm = (pdf: Mm, expected: Mm): number =>
  Math.max(Math.abs(pdf.width - expected.width), Math.abs(pdf.height - expected.height))

/** Короткая подпись для бейджа: «PDF 210×297 мм · расхождение 0,1 мм». */
export const previewBadge = (pdf: Mm, expected: Mm): string => {
  const diff = sizeDiffMm(pdf, expected)
  const diffText = diff < 0.05 ? 'совпадает' : `расхождение ${diff.toFixed(1).replace('.', ',')} мм`
  return `PDF ${pdf.width}×${pdf.height} мм · ${diffText}`
}

export const isMatch = (pdf: Mm, expected: Mm): boolean => sizeDiffMm(pdf, expected) <= 1
