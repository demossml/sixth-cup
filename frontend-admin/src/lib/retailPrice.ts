/**
 * Цена продажи техкарты: из меню, своя цена карты или наценка от себестоимости.
 *
 * Раньше редактор всегда брал цену товара каталога, поэтому ввод суммы не менял
 * маржу (аудит 24.11.2026). Здесь одно правило для экрана и для сохранения.
 */
import type { RetailMode } from './costApi'

export type RetailInput = {
  mode: RetailMode
  /** Цена товара каталога, ₽ (null — у товара нет цены). */
  catalogPriceRub: number | null
  /** Своя цена карты, ₽. */
  manualPriceRub: number | null
  /** Наценка от себестоимости, %. */
  markupPct: number | null
  /** Себестоимость порции, ₽. */
  costPerUnitRub: number | null
}

export const RETAIL_MODE_LABELS: Record<RetailMode, string> = {
  catalog: 'Из меню',
  manual: 'Своя цена',
  markup: 'Наценка, %',
}

/** Цена по наценке: себестоимость × (1 + pct/100), округлённая до копеек. */
export function priceFromMarkup(costPerUnitRub: number | null, markupPct: number | null): number | null {
  if (costPerUnitRub == null || !Number.isFinite(costPerUnitRub)) return null
  if (markupPct == null || !Number.isFinite(markupPct) || markupPct < 0) return null
  return Math.round(costPerUnitRub * (1 + markupPct / 100) * 100) / 100
}

/** Действующая цена продажи с учётом режима и разумных фолбэков. */
export function resolveRetailPrice(input: RetailInput): number | null {
  const catalog = input.catalogPriceRub != null && input.catalogPriceRub > 0 ? input.catalogPriceRub : null
  const markup = priceFromMarkup(input.costPerUnitRub, input.markupPct)
  const manual = input.manualPriceRub != null && Number.isFinite(input.manualPriceRub) ? input.manualPriceRub : null
  if (input.mode === 'manual') return manual ?? catalog ?? markup
  if (input.mode === 'markup') return markup ?? manual ?? catalog
  return catalog ?? manual ?? markup
}

export function foodCostPercent(costPerUnitRub: number | null, retailPriceRub: number | null): number | null {
  if (costPerUnitRub == null || retailPriceRub == null || retailPriceRub <= 0) return null
  return Math.round((costPerUnitRub / retailPriceRub) * 1000) / 10
}

export function marginRub(costPerUnitRub: number | null, retailPriceRub: number | null): number | null {
  if (costPerUnitRub == null || retailPriceRub == null) return null
  return Math.round((retailPriceRub - costPerUnitRub) * 100) / 100
}
