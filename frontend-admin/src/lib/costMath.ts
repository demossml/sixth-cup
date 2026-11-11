/**
 * Математика техкарты на клиенте: та же логика, что в `backend/.../costCalc.ts`,
 * но только для живого ввода — итог всё равно пересчитывает сервер.
 *
 * Двунаправленность: пользователь может ввести брутто + % потерь, либо брутто + нетто,
 * либо брутто + выход. Недостающее считается здесь, чтобы не ждать ответа сервера.
 */

export type LineNumbers = {
  netto: number
  yieldQty: number
  lossColdPct: number
  lossHotPct: number
}

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits

export function lineNumbers(input: {
  brutto: number
  lossColdPct?: number | null
  lossHotPct?: number | null
  /** Явно введённое нетто важнее процента холодных потерь. */
  netto?: number | null
  /** Явно введённый выход важнее процента горячих потерь. */
  yieldQty?: number | null
}): LineNumbers {
  const brutto = Number(input.brutto) || 0
  let lossCold = Number(input.lossColdPct ?? 0) || 0
  let lossHot = Number(input.lossHotPct ?? 0) || 0

  let netto: number
  if (input.netto != null && Number.isFinite(input.netto)) {
    netto = Number(input.netto)
    lossCold = brutto > 0 ? round((1 - netto / brutto) * 100, 2) : 0
  } else {
    netto = brutto * (1 - lossCold / 100)
  }

  let yieldQty: number
  if (input.yieldQty != null && Number.isFinite(input.yieldQty)) {
    yieldQty = Number(input.yieldQty)
    lossHot = netto > 0 ? round((1 - yieldQty / netto) * 100, 2) : 0
  } else {
    yieldQty = netto * (1 - lossHot / 100)
  }

  return { netto: round(netto), yieldQty: round(yieldQty), lossColdPct: round(lossCold, 2), lossHotPct: round(lossHot, 2) }
}

/** Себестоимость строки: цена идёт за брутто (сколько списываем со склада). */
export function lineCostRub(brutto: number, unitCostRub: number | null | undefined): number | null {
  if (unitCostRub == null || !Number.isFinite(unitCostRub)) return null
  if (!Number.isFinite(brutto) || brutto <= 0) return null
  return Math.round(brutto * unitCostRub * 1000) / 1000
}

export function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(2).replace('.', ',')} ₽`
}

export function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(1).replace('.', ',')} %`
}

export const UNIT_LABELS: Record<string, string> = { kg: 'кг', g: 'г', l: 'л', ml: 'мл', pcs: 'шт' }

export const KIND_LABELS: Record<string, string> = { dish: 'Блюдо', semi: 'Заготовка', modifier: 'Модификатор' }
/** Статьи постоянных расходов — один словарь для «Расходов», карт и ТТК. */
export const OVERHEAD_KIND_LABELS: Record<string, string> = {
  electricity: 'Электричество',
  salary: 'Зарплата',
  rent: 'Аренда',
  tax: 'Налоги',
  other: 'Другое',
}

export const WRITE_OFF_LABELS: Record<string, string> = {
  ingredients: 'списывать ингредиенты',
  semi: 'списывать заготовку',
  semi_then_ingredients: 'сначала заготовку, потом ингредиенты',
  none: 'не списывать',
}

export const COST_SOURCE_LABELS: Record<string, string> = {
  invoice: 'из накладных',
  history: 'последняя известная',
  manual: 'ручная цена',
  none: 'нет цены',
}
