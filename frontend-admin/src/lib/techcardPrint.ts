/**
 * F13: модель печатной технологической карты (ТТК).
 *
 * Чистые функции: страница только рисует. Так форму видно в тестах — включая то,
 * что нельзя проверить на глаз: подписи потерь, единицы заготовок, полную
 * себестоимость и «себестоимость не посчитана».
 */
import type { CardLine, TechCard, Unit } from './costApi'
import { KIND_LABELS, UNIT_LABELS } from './costMath'

export type PrintIngredientRow = {
  n: number
  name: string
  /** Брутто в единицах строки. */
  brutto: string
  /** Нетто после холодной обработки. */
  netto: string
  /** Выход после горячей обработки. */
  out: string
  unit: string
  unitPriceRub: string
  sumRub: string
  /** «потери хол. 5 %» — только когда они реально заданы. */
  losses: string | null
  /** Заготовка в составе: в карточке видно, что это не сырьё. */
  isSemi: boolean
}

export type PrintTotalRow = { label: string; value: string; strong?: boolean }

export type TechCardPrint = {
  number: string
  title: string
  kind: string
  versionText: string
  outputText: string
  rows: PrintIngredientRow[]
  totals: PrintTotalRow[]
  technology: string
  /** Предупреждения, которые нельзя печатать «молча». */
  warnings: string[]
}

const num = (v: number | null | undefined, digits = 3): string => {
  if (v == null || !Number.isFinite(v)) return '—'
  const rounded = Math.round(v * 10 ** digits) / 10 ** digits
  return String(rounded).replace('.', ',')
}

const money = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(2).replace('.', ',')

/** Единица строки: у сырья своя, у заготовки — единица выхода заготовки. */
export function lineUnit(line: CardLine, fallback: Unit): string {
  const unit = line.itemUnit ?? line.childOutputUnit ?? fallback
  return UNIT_LABELS[unit] ?? unit
}

function lossesText(line: CardLine): string | null {
  const parts: string[] = []
  if (line.lossColdPct) parts.push(`хол. ${num(line.lossColdPct, 2)} %`)
  if (line.lossHotPct) parts.push(`гор. ${num(line.lossHotPct, 2)} %`)
  return parts.length ? `потери ${parts.join(', ')}` : null
}

/** Строка таблицы «Рецептура» — ровно те графы, что нужны на кухне и бухгалтеру. */
export function ingredientRow(line: CardLine, index: number, fallbackUnit: Unit): PrintIngredientRow {
  return {
    n: index + 1,
    name: line.stockItemName ?? line.childCardName ?? '—',
    brutto: num(line.qtyBrutto),
    netto: num(line.qtyNetto),
    out: num(line.qtyYield),
    unit: lineUnit(line, fallbackUnit),
    unitPriceRub: line.unitCostRub == null ? '—' : money(line.unitCostRub),
    sumRub: money(line.lineCostRub),
    losses: lossesText(line),
    isSemi: line.childCardId != null,
  }
}

function versionText(card: TechCard): string {
  if (!card.version) return 'черновик без версии'
  const d = new Date(card.version.validFrom)
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
  return `действует с ${date}${card.version.note ? ` · ${card.version.note}` : ''}`
}

export function techCardPrint(card: TechCard): TechCardPrint {
  const rows = card.lines.map((l, i) => ingredientRow(l, i, card.outputUnit))

  const totals: PrintTotalRow[] = [
    { label: 'Выход изделия', value: `${num(card.outputQty)} ${UNIT_LABELS[card.outputUnit] ?? ''}`.trim() },
    { label: 'Себестоимость сырья', value: `${money(card.costRub)} ₽` },
    { label: 'Себестоимость порции', value: `${money(card.costPerUnitRub)} ₽`, strong: true },
  ]
  if (card.overheadEnabled && card.overheadPerUnitRub != null) {
    totals.push({ label: 'Постоянные расходы на порцию', value: `${money(card.overheadPerUnitRub)} ₽` })
    totals.push({ label: 'Полная себестоимость', value: `${money(card.fullCostPerUnitRub)} ₽`, strong: true })
  }
  totals.push({ label: 'Цена продажи', value: card.retailRub == null ? '—' : `${money(card.retailRub)} ₽` })
  totals.push({
    label: 'Фудкост',
    value: card.foodCostPct == null ? '—' : `${money(card.foodCostPct)} %`,
  })
  // «Фудкост с расходами» печатаем только когда расходы реально начислены:
  // при включённом флаге и нулевых суммах он дублировал бы обычный фудкост.
  if (card.overheadEnabled && card.overheadPerUnitRub != null && card.fullFoodCostPct != null) {
    totals.push({ label: 'Фудкост с расходами', value: `${money(card.fullFoodCostPct)} %` })
  }
  totals.push({ label: 'Маржа', value: card.marginRub == null ? '—' : `${money(card.marginRub)} ₽` })

  const warnings: string[] = []
  if (card.missingPrices) warnings.push('У части сырья нет цены — себестоимость посчитана не полностью.')
  if (card.costPerUnitRub == null) warnings.push('Себестоимость не посчитана: заполните цены сырья.')
  if (!card.lines.length) warnings.push('Состав не заполнен — карточка пустая.')
  if (card.retailRub == null) warnings.push('Не задана цена продажи.')

  return {
    number: String(card.id),
    title: card.name,
    kind: KIND_LABELS[card.kind] ?? card.kind,
    versionText: versionText(card),
    outputText: `${num(card.outputQty)} ${UNIT_LABELS[card.outputUnit] ?? ''}`.trim(),
    rows,
    totals,
    technology: card.methodText?.trim() || '—',
    warnings,
  }
}
