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

/* ────────────── постоянные расходы на порцию (электричество, ЗП, аренда, налоги) ────────────── */

export type OverheadMode = 'units' | 'revenue'

export type OverheadAllocation = {
  /** Сколько постоянных расходов приходится на одну проданную единицу, копейки. */
  perUnitKop: number | null
  /** Доля постоянных в цене позиции (только для режима «по выручке»), %. */
  shareOfPricePct?: number | null
  /** Откуда взяли базу распределения — важно для честной подписи в UI. */
  basis: 'sales' | 'planned' | 'none'
  units: number
  revenueKop: number
}

/**
 * Постоянные расходы за период раскладываются на проданные единицы.
 *
 * - `units`: сумма / количество проданных единиц — ровно то, что владелец ждёт от «кружки»;
 * - `revenue`: сумма × (цена позиции / выручка) — честнее для меню с разными ценами
 *   (дорогое блюдо забирает больше аренды).
 *
 * Если продаж в базе нет, берём плановый объём из настроек; если и его нет — `null`,
 * чтобы UI показал «нужен объём продаж», а не выдуманное число.
 */
export function overheadPerUnit(input: {
  totalKop: number
  mode: OverheadMode
  soldUnits: number
  revenueKop: number
  priceKop?: number | null
  plannedUnits?: number | null
}): OverheadAllocation {
  const total = Math.max(0, Number(input.totalKop) || 0)
  const sold = Math.max(0, Number(input.soldUnits) || 0)
  const planned = Math.max(0, Number(input.plannedUnits ?? 0) || 0)
  const units = sold > 0 ? sold : planned
  const basis: OverheadAllocation['basis'] = sold > 0 ? 'sales' : planned > 0 ? 'planned' : 'none'
  const revenue = Math.max(0, Number(input.revenueKop) || 0)

  if (units <= 0 || total === 0) {
    return { perUnitKop: null, basis: 'none', units, revenueKop: revenue }
  }

  if (input.mode === 'revenue') {
    const price = Number(input.priceKop ?? 0)
    // Выручка неизвестна (нет продаж) — считаем по средней цене планового объёма.
    const revenueBase = revenue > 0 ? revenue : units * (price > 0 ? price : 1)
    if (price <= 0) return { perUnitKop: null, basis, units, revenueKop: revenueBase }
    const perUnit = (total * price) / revenueBase
    return {
      perUnitKop: perUnit,
      shareOfPricePct: price > 0 ? round((perUnit / price) * 100, 1) : null,
      basis,
      units,
      revenueKop: revenueBase,
    }
  }

  return { perUnitKop: total / units, basis, units, revenueKop: revenue }
}

/* ─────────────── меню-инжиниринг: продажи × маржа (звёзды, лошадки, загадки, собаки) ─────────────── */

export type MenuEngineeringInput = {
  cardId: number
  name: string
  kind?: string | null
  /** Сколько продано за окно анализа (шт). */
  qtySold: number
  /** Выручка за окно, копейки. */
  revenueKop: number
  /** Себестоимость единицы, копейки: полная (с расходами), если флаг включён, иначе сырьё. */
  costPerUnitKop: number | null
  /** Цена меню, копейки (для позиций без продаж — чтобы показать потенциал). */
  priceKop: number | null
}

/** Классические четыре клетки меню-инжиниринга (Kasavana & Smith). */
export type MenuCategory = 'star' | 'plowhorse' | 'puzzle' | 'dog' | 'none'
export type AbcClass = 'A' | 'B' | 'C'

export type MenuEngineeringRow = MenuEngineeringInput & {
  avgPriceKop: number | null
  profitKop: number | null
  marginPerUnitKop: number | null
  /** Маржинальность, % от выручки. */
  marginPct: number | null
  shareRevenuePct: number
  shareProfitPct: number
  abcRevenue: AbcClass | null
  abcProfit: AbcClass | null
  category: MenuCategory
  /** Что делать владельцу — одна строка человеческим языком. */
  advice: string
  /** Почему позиция не попала в анализ (нет продаж / нет себестоимости). */
  reason: string | null
}

export type MenuEngineeringResult = {
  rows: MenuEngineeringRow[]
  totals: {
    /** Позиций в анализе (есть продажи и себестоимость). */
    counted: number
    /** Всего карт в меню. */
    cards: number
    qtySold: number
    revenueKop: number
    costKop: number
    profitKop: number
    marginPct: number | null
    /** Сколько позиций без продаж / без себестоимости. */
    noSales: number
    noCost: number
  }
  thresholds: {
    /** Порог популярности: 70 % от среднего объёма продаж на позицию. */
    popularityQty: number | null
    /** Средняя маржа на единицу по проданному объёму. */
    marginPerUnitKop: number | null
    popularityFactor: number
  }
}

const MENU_ADVICE: Record<Exclude<MenuCategory, 'none'>, string> = {
  star: 'Хорошо продаётся и хорошо зарабатывает — держим в меню и на витрине.',
  plowhorse: 'Берут часто, но маржа низкая: поднять цену на 5–10 % или снизить себестоимость.',
  puzzle: 'Маржа отличная, но берут редко: вынести на витрину, переименовать, добавить в комбо.',
  dog: 'Продаётся слабо и почти не зарабатывает: заменить рецептуру или убрать из меню.',
}

/** Кумулятивные доли 80/95 % → A/B/C. */
function abcBy<K extends string | number>(
  rows: { key: K; value: number }[],
  limits: [number, number] = [80, 95],
): Map<K, AbcClass> {
  const out = new Map<K, AbcClass>()
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0)
  if (total <= 0) return out
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  let cum = 0
  sorted.forEach((r, i) => {
    cum += Math.max(0, r.value)
    const share = (cum / total) * 100
    // Первая позиция всегда A: иначе при единственной карте всё уехало бы в C.
    out.set(r.key, i === 0 || share <= limits[0] ? 'A' : share <= limits[1] ? 'B' : 'C')
  })
  return out
}

/**
 * Меню-инжиниринг: раскладывает позиции по популярности и марже.
 *
 * Популярность — объём продаж за окно; порог = 70 % от среднего объёма на позицию
 * (классика Kasavana–Smith). Маржа — прибыль на единицу; порог = средняя маржа по
 * проданному объёму (взвешенная по количеству), поэтому он сам подстраивается под меню.
 *
 * Позиции без продаж или без себестоимости не ломают расчёт: они попадают в `rows`
 * с `category: 'none'` и причиной — их видно, но они не тянут пороги.
 */
export function menuEngineering(
  items: MenuEngineeringInput[],
  opts: { popularityFactor?: number } = {},
): MenuEngineeringResult {
  const factor = opts.popularityFactor && opts.popularityFactor > 0 ? opts.popularityFactor : 0.7
  const normalized = items.map((it) => ({
    ...it,
    qtySold: Math.max(0, Number(it.qtySold) || 0),
    revenueKop: Math.max(0, Number(it.revenueKop) || 0),
  }))

  const participants = normalized.filter((it) => it.qtySold > 0 && it.revenueKop > 0 && it.costPerUnitKop != null)
  const totalQty = participants.reduce((s, it) => s + it.qtySold, 0)
  const totalRevenue = participants.reduce((s, it) => s + it.revenueKop, 0)
  const totalCost = participants.reduce((s, it) => s + it.qtySold * (it.costPerUnitKop as number), 0)
  const totalProfit = totalRevenue - totalCost

  const popularityQty = participants.length ? round((factor * totalQty) / participants.length, 2) : null
  const marginThreshold = participants.length && totalQty > 0 ? totalProfit / totalQty : null

  const abcRevenue = abcBy(participants.map((it) => ({ key: it.cardId, value: it.revenueKop })))
  const abcProfit = abcBy(
    participants.map((it) => ({ key: it.cardId, value: it.revenueKop - it.qtySold * (it.costPerUnitKop as number) })),
  )

  const rows: MenuEngineeringRow[] = normalized.map((it) => {
    const avgPriceKop = it.qtySold > 0 ? it.revenueKop / it.qtySold : it.priceKop
    const profitKop =
      it.costPerUnitKop == null || it.qtySold <= 0 ? null : it.revenueKop - it.qtySold * it.costPerUnitKop
    const marginPerUnitKop = profitKop != null && it.qtySold > 0 ? profitKop / it.qtySold : null
    const marginPct = profitKop != null && it.revenueKop > 0 ? round((profitKop / it.revenueKop) * 100, 1) : null

    let reason: string | null = null
    if (it.qtySold <= 0) reason = 'нет продаж за период'
    else if (it.costPerUnitKop == null) reason = 'не посчитана себестоимость — заполните цены сырья'
    else if (it.revenueKop <= 0) reason = 'нет выручки за период'

    let category: MenuCategory = 'none'
    if (!reason && marginPerUnitKop != null && popularityQty != null && marginThreshold != null) {
      const popular = it.qtySold >= popularityQty
      // Продажа в минус — всегда «собака», даже при большом объёме: это дыра в кассе,
      // а не «лошадка». Порог средней маржи может быть отрицательным, поэтому такая
      // проверка нужна отдельно.
      if (marginPerUnitKop <= 0) {
        category = 'dog'
      } else {
        const profitable = marginPerUnitKop >= marginThreshold
        category = popular ? (profitable ? 'star' : 'plowhorse') : profitable ? 'puzzle' : 'dog'
      }
    }

    return {
      ...it,
      avgPriceKop,
      profitKop,
      marginPerUnitKop,
      marginPct,
      shareRevenuePct: totalRevenue > 0 ? round((it.revenueKop / totalRevenue) * 100, 1) : 0,
      shareProfitPct: totalProfit > 0 && profitKop != null ? round((profitKop / totalProfit) * 100, 1) : 0,
      abcRevenue: abcRevenue.get(it.cardId) ?? null,
      abcProfit: abcProfit.get(it.cardId) ?? null,
      category,
      advice: category === 'none' ? (reason ?? 'недостаточно данных') : MENU_ADVICE[category],
      reason,
    }
  })

  // Проданное — по выручке, непроданное — в конце: владелец сначала смотрит на то, что кормит.
  rows.sort((a, b) => Number(b.qtySold > 0) - Number(a.qtySold > 0) || b.revenueKop - a.revenueKop)

  return {
    rows,
    totals: {
      counted: participants.length,
      cards: normalized.length,
      qtySold: totalQty,
      revenueKop: totalRevenue,
      costKop: totalCost,
      profitKop: totalProfit,
      marginPct: totalRevenue > 0 ? round((totalProfit / totalRevenue) * 100, 1) : null,
      noSales: normalized.filter((it) => it.qtySold <= 0).length,
      noCost: normalized.filter((it) => it.qtySold > 0 && it.costPerUnitKop == null).length,
    },
    thresholds: { popularityQty, marginPerUnitKop: marginThreshold, popularityFactor: factor },
  }
}

/* ───────── распределение постоянных расходов по структуре продаж (план или факт) ───────── */

export type OverheadKind = 'electricity' | 'salary' | 'rent' | 'tax' | 'other'

/** Сколько единиц позиции продаём (план) или продали (факт) и на какую выручку. */
export type SalesMixRow = { cardId: number; units: number; revenueKop: number }

export type OverheadAllocationRow = {
  cardId: number
  units: number
  /** Доля позиции в базе распределения, %. Сумма долей = 100. */
  sharePct: number
  /** Постоянные расходы, которые «сидят» в позиции за период, копейки. */
  overheadKop: number
  /** То же на одну единицу, копейки. */
  perUnitKop: number
  /** Разбивка по статьям на одну единицу — «сколько аренды в этой чашке». */
  breakdown: { kind: OverheadKind; perUnitKop: number }[]
}

export type OverheadAllocationResult = {
  rows: OverheadAllocationRow[]
  /** База: по выручке, по количеству или её нет. */
  basis: 'revenue' | 'units' | 'none'
  totalKop: number
  totalUnits: number
  totalRevenueKop: number
}

/**
 * Раскладывает постоянные расходы месяца по позициям меню.
 *
 * Ключевое отличие от «сумма / всё количество»: каждая позиция получает **свою** долю
 * расходов (по доле в выручке или по доле в количестве), а внутри позиции сумма делится
 * на её собственный план продаж. Поэтому капучино с 70 % продаж забирает 70 % аренды,
 * и в чашке эспрессо аренды меньше, а не «2 500 ₽ в каждой».
 *
 * Если базы нет (ни продаж, ни плана) — `basis: 'none'` и нули: UI должен честно попросить
 * заполнить план, а не показывать выдуманное число.
 */
export function allocateOverheads(input: {
  /** Статьи расходов за месяц (уже приведённые к месяцу), копейки. */
  articles: { kind: OverheadKind; amountKop: number }[]
  mode: 'units' | 'revenue'
  mix: SalesMixRow[]
}): OverheadAllocationResult {
  const totalKop = input.articles.reduce((s, a) => s + Math.max(0, a.amountKop), 0)
  const rows = input.mix
    .map((m) => ({ cardId: m.cardId, units: Math.max(0, m.units), revenueKop: Math.max(0, m.revenueKop) }))
    .filter((m) => m.units > 0)

  const totalUnits = rows.reduce((s, m) => s + m.units, 0)
  const totalRevenueKop = rows.reduce((s, m) => s + m.revenueKop, 0)

  // По выручке распределяем только если выручка вообще известна, иначе честно падаем на количество.
  const basis: 'revenue' | 'units' | 'none' =
    totalUnits <= 0 ? 'none' : input.mode === 'revenue' && totalRevenueKop > 0 ? 'revenue' : 'units'

  if (basis === 'none' || totalKop <= 0) {
    return {
      rows: rows.map((m) => ({ cardId: m.cardId, units: m.units, sharePct: 0, overheadKop: 0, perUnitKop: 0, breakdown: [] })),
      basis,
      totalKop,
      totalUnits,
      totalRevenueKop,
    }
  }

  const weightOf = (m: SalesMixRow) => (basis === 'revenue' ? m.revenueKop : m.units)
  const totalWeight = rows.reduce((s, m) => s + weightOf(m), 0)

  return {
    rows: rows.map((m) => {
      const share = totalWeight > 0 ? weightOf(m) / totalWeight : 0
      const overheadKop = totalKop * share
      return {
        cardId: m.cardId,
        units: m.units,
        sharePct: round(share * 100, 1),
        overheadKop: round(overheadKop, 2),
        perUnitKop: round(overheadKop / m.units, 2),
        breakdown: input.articles
          .filter((a) => a.amountKop > 0)
          .map((a) => ({ kind: a.kind, perUnitKop: round((a.amountKop * share) / m.units, 2) })),
      }
    }),
    basis,
    totalKop,
    totalUnits,
    totalRevenueKop,
  }
}


/**
 * Штуки из весов популярности: `units = общий план × вес / сумма весов`.
 *
 * Владелец двигает ползунки («это продаётся чаще»), а не вписывает штуки по каждой позиции.
 * Если все веса нулевые — считаем, что позиции продаются одинаково: иначе план пропадёт.
 */
export function unitsFromWeights(
  weights: Map<number, number>,
  totalPlan: number,
  cardIds: number[],
): Map<number, number> {
  const out = new Map<number, number>()
  const plan = Math.max(0, Number(totalPlan) || 0)
  const sum = [...weights.values()].reduce((s, w) => s + Math.max(0, w), 0)
  if (sum > 0) {
    for (const id of cardIds) out.set(id, (plan * Math.max(0, weights.get(id) ?? 0)) / sum)
    return out
  }
  if (plan > 0 && cardIds.length > 0) {
    for (const id of cardIds) out.set(id, plan / cardIds.length)
  }
  return out
}
