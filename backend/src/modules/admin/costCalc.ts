/**
 * Расчётный движок техкарт (F2 плана «Себестоимость + техкарта»).
 *
 * Здесь только чистые функции — без БД и без HTTP, чтобы правила считались одинаково
 * в API, в проекции на склад и в тестах.
 *
 * Ключевые правила (взяты из практики iiko / Quick Resto / Poster, см.
 * docs/RESEARCH-COST-TECHCARDS-2026-11-11.md):
 *  - себестоимость считается по БРУТТО (сколько списываем со склада);
 *  - потери бывают отрицательными (варка круп и макарон прибавляет вес);
 *  - брутто / нетто / выход / проценты потерь — двунаправленный ввод;
 *  - цена — средневзвешенная из приходных накладных, с честными фолбэками;
 *  - норма закладки делит стоимость карты на количество порций.
 */

export type Unit = 'kg' | 'l' | 'pcs' | 'g' | 'ml'
export type UnitGroup = 'mass' | 'volume' | 'count'

export type ItemMeta = {
  unit: Unit
  /** Вес одной штуки в кг: без него «стакан × 1» не пересчитать в граммы. */
  weightPerPcKg?: number | null
  /** Плотность кг/л: по умолчанию 1 (как в iiko, где литр без веса даёт нули). */
  densityKgL?: number | null
}

export const UNIT_GROUP: Record<Unit, UnitGroup> = {
  kg: 'mass',
  g: 'mass',
  l: 'volume',
  ml: 'volume',
  pcs: 'count',
}

/** Множитель к базовой единице группы: кг → 1000 г, л → 1000 мл. */
const UNIT_FACTOR: Record<Unit, number> = { kg: 1000, g: 1, l: 1000, ml: 1, pcs: 1 }

/**
 * Перевод количества из одной единицы в другую.
 * Возвращает `null`, если перевод невозможен (нет веса штуки, нет плотности).
 */
export function convertQty(qty: number, from: Unit, to: Unit, meta: ItemMeta): number | null {
  if (!Number.isFinite(qty)) return null
  if (from === to) return qty
  const gFrom = UNIT_GROUP[from]
  const gTo = UNIT_GROUP[to]
  if (gFrom === gTo) return (qty * UNIT_FACTOR[from]) / UNIT_FACTOR[to]

  const density = meta.densityKgL ?? 1
  // масса ↔ объём — через плотность (кг ↔ л).
  if (gFrom === 'mass' && gTo === 'volume') {
    const kg = (qty * UNIT_FACTOR[from]) / 1000
    const litres = kg / (density > 0 ? density : 1)
    return (litres * 1000) / UNIT_FACTOR[to]
  }
  if (gFrom === 'volume' && gTo === 'mass') {
    const litres = (qty * UNIT_FACTOR[from]) / 1000
    const kg = litres * (density > 0 ? density : 1)
    return (kg * 1000) / UNIT_FACTOR[to]
  }
  // штуки → масса: нужен вес штуки.
  if (gFrom === 'count' && gTo === 'mass') {
    const per = meta.weightPerPcKg
    if (!per || per <= 0) return null
    const kg = qty * per
    return (kg * 1000) / UNIT_FACTOR[to]
  }
  // масса → штуки: тоже через вес штуки.
  if (gFrom === 'mass' && gTo === 'count') {
    const per = meta.weightPerPcKg
    if (!per || per <= 0) return null
    const kg = (qty * UNIT_FACTOR[from]) / 1000
    return kg / per
  }
  return null
}

/* ─────────────── выход и потери (двунаправленный ввод) ─────────────── */

export type YieldInput = {
  brutto: number
  netto?: number | null
  yieldQty?: number | null
  lossColdPct?: number | null
  lossHotPct?: number | null
}

export type YieldResolved = {
  brutto: number
  netto: number
  yieldQty: number
  lossColdPct: number
  lossHotPct: number
  /** Что посчитали сами, а что пришло из ввода — для подсветки в UI. */
  computed: ('netto' | 'yieldQty' | 'lossColdPct' | 'lossHotPct')[]
  warnings: string[]
}

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits

/**
 * Считает недостающие величины. Приоритет: явное нетто/выход важнее процентов
 * (пользователь мог ввести «после зачистки осталось 0,8 кг» — это точнее, чем %).
 */
export function resolveYield(input: YieldInput): YieldResolved {
  const warnings: string[] = []
  const computed: YieldResolved['computed'] = []
  const brutto = Number(input.brutto)

  if (!Number.isFinite(brutto) || brutto <= 0) {
    return {
      brutto: 0,
      netto: 0,
      yieldQty: 0,
      lossColdPct: 0,
      lossHotPct: 0,
      computed,
      warnings: ['брутто должно быть больше нуля'],
    }
  }

  let lossCold = input.lossColdPct ?? 0
  let lossHot = input.lossHotPct ?? 0
  let netto: number
  let yieldQty: number

  if (input.netto != null && Number.isFinite(input.netto)) {
    netto = Number(input.netto)
    lossCold = round((1 - netto / brutto) * 100)
    computed.push('lossColdPct')
  } else {
    netto = brutto * (1 - lossCold / 100)
    computed.push('netto')
  }

  if (input.yieldQty != null && Number.isFinite(input.yieldQty)) {
    yieldQty = Number(input.yieldQty)
    lossHot = netto > 0 ? round((1 - yieldQty / netto) * 100) : 0
    computed.push('lossHotPct')
  } else {
    yieldQty = netto * (1 - lossHot / 100)
    computed.push('yieldQty')
  }

  if (lossCold >= 100 || lossHot >= 100) warnings.push('потери 100 % и выше — строка выпадет из расчёта')
  if (netto <= 0) warnings.push('нетто получилось нулевым — проверьте брутто и потери')
  if (yieldQty <= 0) warnings.push('выход получился нулевым — проверьте потери горячей обработки')

  return {
    brutto: round(brutto),
    netto: round(netto),
    yieldQty: round(yieldQty),
    lossColdPct: round(lossCold, 2),
    lossHotPct: round(lossHot, 2),
    computed: [...new Set(computed)],
    warnings,
  }
}

/* ───────────────────────── цены ───────────────────────── */

export type PurchasePoint = { at: number; qty: number; unitCostKop: number }
export type PricePoint = { at: number; costKop: number; source?: 'invoice' | 'inventory' | 'manual' | 'backfill' }
export type CostSource = 'invoice' | 'history' | 'manual' | 'none'
export type UnitCost = { costKop: number | null; source: CostSource }

/**
 * Средневзвешенная цена за базовую единицу по накладным в окне `since`.
 * Фолбэки: последняя известная цена → ручная цена → «нет цены».
 */
export function weightedCostKop(
  purchases: PurchasePoint[],
  opts: { since: number; history?: PricePoint[]; manualKop?: number | null },
): UnitCost {
  let qty = 0
  let sum = 0
  for (const p of purchases) {
    if (!Number.isFinite(p.qty) || p.qty <= 0) continue
    if (p.at < opts.since) continue
    if (!Number.isFinite(p.unitCostKop)) continue
    qty += p.qty
    sum += p.qty * p.unitCostKop
  }
  if (qty > 0) return { costKop: sum / qty, source: 'invoice' }

  const last = (opts.history ?? []).reduce<PricePoint | null>(
    (acc, h) => (acc == null || h.at > acc.at ? h : acc),
    null,
  )
  // Ручную цену так и называем — владельцу важно видеть, что это его цифра, а не накладная.
  if (last) return { costKop: last.costKop, source: last.source === 'manual' ? 'manual' : 'history' }
  if (opts.manualKop != null && Number.isFinite(opts.manualKop)) {
    return { costKop: opts.manualKop, source: 'manual' }
  }
  return { costKop: null, source: 'none' }
}

/** Начало окна: последняя полная инвентаризация или `days` назад, что позже. */
export function priceWindowStart(now: number, lastInventoryAt: number | null | undefined, days = 90): number {
  const byAge = now - Math.max(0, days) * 24 * 60 * 60 * 1000
  if (lastInventoryAt && lastInventoryAt > byAge) return lastInventoryAt
  return byAge
}

/* ───────────────────────── строки и карты ───────────────────────── */

export type LineInput = {
  qtyBrutto: number
  lossColdPct?: number | null
  lossHotPct?: number | null
  qtyNetto?: number | null
  qtyYield?: number | null
  lineRole?: 'base' | 'optional'
  /** Себестоимость базовой единицы ингредиента (копейки) либо null, если цены нет. */
  unitCostKop?: number | null
  /** Единица строки и единица позиции склада — для перевода. */
  fromUnit?: Unit
  toUnit?: Unit
  meta?: ItemMeta
  /** Или ссылка на заготовку: её себестоимость за единицу и норма закладки. */
  child?: { costKop: number | null; outputQty: number; outputUnit: Unit } | null
}

export type LineResolved = {
  yield: YieldResolved
  costKop: number | null
  optional: boolean
}

export type CardTotals = {
  costKop: number | null
  optionalKop: number | null
  missing: boolean
  lines: LineResolved[]
}

/**
 * Себестоимость строки: брутто (в единицах склада) × цена базовой единицы.
 * Для заготовки — количество заготовки × её себестоимость за единицу.
 */
export function resolveLine(line: LineInput): LineResolved {
  const y = resolveYield({
    brutto: line.qtyBrutto,
    netto: line.qtyNetto,
    yieldQty: line.qtyYield,
    lossColdPct: line.lossColdPct,
    lossHotPct: line.lossHotPct,
  })
  const optional = line.lineRole === 'optional'

  if (line.child) {
    const { costKop, outputQty } = line.child
    if (costKop == null || !(outputQty > 0)) return { yield: y, costKop: null, optional }
    return { yield: y, costKop: (y.brutto / outputQty) * costKop, optional }
  }

  if (line.unitCostKop == null || !Number.isFinite(line.unitCostKop)) {
    return { yield: y, costKop: null, optional }
  }

  let qtyBase = y.brutto
  if (line.fromUnit && line.toUnit && line.fromUnit !== line.toUnit) {
    const converted = convertQty(y.brutto, line.fromUnit, line.toUnit, line.meta ?? { unit: line.toUnit })
    if (converted == null) return { yield: y, costKop: null, optional }
    qtyBase = converted
  }
  return { yield: y, costKop: qtyBase * line.unitCostKop, optional }
}

export function cardTotals(lines: LineInput[]): CardTotals {
  let cost = 0
  let optional = 0
  let missing = false
  const resolved: LineResolved[] = []
  for (const line of lines) {
    const r = resolveLine(line)
    resolved.push(r)
    if (r.costKop == null) {
      missing = true
      continue
    }
    if (r.optional) optional += r.costKop
    else cost += r.costKop
  }
  return {
    costKop: missing && cost === 0 ? null : cost,
    optionalKop: optional,
    missing,
    lines: resolved,
  }
}

/** Себестоимость одной порции/единицы карты: сумма / норма закладки. */
export function costPerUnitKop(totalKop: number | null, outputQty: number): number | null {
  if (totalKop == null || !(outputQty > 0)) return null
  return totalKop / outputQty
}

export function foodCostPct(costKop: number | null, retailKop: number | null): number | null {
  if (costKop == null || retailKop == null || retailKop <= 0) return null
  return round((costKop / retailKop) * 100, 1)
}

export function marginKop(costKop: number | null, retailKop: number | null): number | null {
  if (costKop == null || retailKop == null) return null
  return retailKop - costKop
}

export function retailFromMarkup(costKop: number | null, markupPct: number): number | null {
  if (costKop == null) return null
  if (!Number.isFinite(markupPct) || markupPct < 0) return null
  return Math.round(costKop * (1 + markupPct / 100))
}

/* ─────────────────── циклы и проекция на склад ─────────────────── */

/** Проверка «заготовка не входит сама в себя». Возвращает путь цикла или null. */
export function findCycle(graph: Record<number, number[]>, start?: number): number[] | null {
  const state = new Map<number, 0 | 1 | 2>()
  const stack: number[] = []
  const dfs = (node: number): number[] | null => {
    state.set(node, 1)
    stack.push(node)
    for (const next of graph[node] ?? []) {
      const st = state.get(next) ?? 0
      if (st === 1) {
        const from = stack.indexOf(next)
        return [...stack.slice(from), next]
      }
      if (st === 0) {
        const found = dfs(next)
        if (found) return found
      }
    }
    stack.pop()
    state.set(node, 2)
    return null
  }
  const roots = start != null ? [start] : Object.keys(graph).map(Number)
  for (const r of roots) {
    if ((state.get(r) ?? 0) === 0) {
      const found = dfs(r)
      if (found) return found
    }
  }
  return null
}

/** Строки карты → нормы расхода склада (то, что раньше жило в product_stock_norms). */
export function projectNorms(
  lines: { stockItemId: number; qty: number; unit?: Unit; targetUnit?: Unit; meta?: ItemMeta }[],
): { stockItemId: number; qty: number }[] {
  const out = new Map<number, number>()
  for (const l of lines) {
    if (!l.stockItemId) continue
    let qty = l.qty
    if (l.unit && l.targetUnit && l.unit !== l.targetUnit) {
      const converted = convertQty(qty, l.unit, l.targetUnit, l.meta ?? { unit: l.targetUnit })
      if (converted == null) continue
      qty = converted
    }
    out.set(l.stockItemId, (out.get(l.stockItemId) ?? 0) + qty)
  }
  return [...out.entries()].map(([stockItemId, qty]) => ({ stockItemId, qty: round(qty, 3) }))
}

/* ───────────────────────── сигналы проблем ───────────────────────── */

export type InsightTone = 'bad' | 'warn' | 'info'
export type Insight = { code: string; text: string; tone: InsightTone }

/** Бейджи карты: то, что у лидеров ловит бухгалтер глазами, у нас ловит система. */
export function cardInsights(input: {
  costKop: number | null
  retailKop: number | null
  missingPrices: boolean
  foodCostPct: number | null
  highFoodCostPct?: number
}): Insight[] {
  const out: Insight[] = []
  if (input.costKop == null) {
    out.push({ code: 'no_cost', text: 'себестоимость не посчитана', tone: 'bad' })
  }
  if (input.missingPrices) {
    out.push({ code: 'no_price', text: 'у части сырья нет цены', tone: 'bad' })
  }
  if (input.retailKop == null || input.retailKop <= 0) {
    out.push({ code: 'no_retail', text: 'не задана цена продажи', tone: 'warn' })
  }
  const limit = input.highFoodCostPct ?? 35
  if (input.foodCostPct != null && input.foodCostPct > limit) {
    out.push({ code: 'high_food_cost', text: `фудкост ${input.foodCostPct} % выше ${limit} %`, tone: 'warn' })
  }
  if (input.costKop != null && input.retailKop != null && input.costKop > input.retailKop) {
    out.push({ code: 'negative_margin', text: 'продаём дешевле себестоимости', tone: 'bad' })
  }
  return out
}
