/**
 * Конфигурация товара для карточки меню: запрос к `/api/directory/config/:id`,
 * расчёт цены выбранной комбинации и сборка строки корзины.
 *
 * Всё, что здесь есть, приходит из админки: объёмы (схема объёмов или SKU-группа),
 * молоко (схема молока), обязательный выбор без цены и добавки (схема добавок).
 */
import type { CartModifier, CartLine } from './preorderApi'

/** Тот же базовый URL, что у остальных запросов PWA (см. `preorderApi`). */
const base = () => (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE || ''

export type VolumeOption = {
  id: string
  label: string
  sizeValue: number | null
  sizeUnit: string | null
  priceRub: number
  available: boolean
  isDefault: boolean
  skuProductId: number | null
}

export type MilkOption = { id: number; label: string; priceRub: number; isDefault: boolean; available: boolean }

export type AddonOption = {
  id: number
  name: string
  priceRub: number
  maxCount: number
  required: boolean
  isDefault: boolean
  available: boolean
  /** «Без сиропа» — вариант «ничего не добавлять»: в цене и составе не участвует. */
  zeroOption?: boolean
}

export type AddonGroup = { key: string; label: string; required: boolean; options: AddonOption[] }

export type ChoiceOption = { id: number; label: string; isDefault: boolean }

export type ProductConfig = {
  ok: true
  productId: number
  name: string
  description: string | null
  imageUrl: string | null
  mediaType?: 'image' | 'video'
  videoUrl?: string | null
  posterUrl?: string | null
  priceRub: number
  available: boolean
  calories: number | null
  proteinG: number | null
  fatG: number | null
  carbsG: number | null
  volumes: VolumeOption[]
  milk: { required: boolean; options: MilkOption[] } | null
  choice: { title: string; options: ChoiceOption[] } | null
  addons: AddonGroup[] | null
}

export type Selection = {
  volumeId: string
  /** `null` — молоко не выбрано (схемы нет). */
  milkId: number | null
  choiceId: number | null
  /** id добавки → количество. */
  addons: Record<number, number>
}

const defaultOf = <T extends { isDefault?: boolean }>(list: T[]): T | null =>
  list.find((x) => x.isDefault) ?? list[0] ?? null

/** Стартовый выбор: первый объём, дефолтное молоко, дефолтный вариант корицы. */
export function initialSelection(cfg: ProductConfig): Selection {
  const volume = defaultOf(cfg.volumes.filter((v) => v.available)) ?? defaultOf(cfg.volumes)
  const milk = cfg.milk ? defaultOf(cfg.milk.options.filter((o) => o.available)) ?? defaultOf(cfg.milk.options) : null
  const choice = cfg.choice ? defaultOf(cfg.choice.options) : null
  return {
    volumeId: volume?.id ?? 'base',
    milkId: milk?.id ?? null,
    choiceId: choice?.id ?? null,
    addons: {},
  }
}

export type SelectionCheck = { ok: boolean; reason?: string }

/**
 * Можно ли положить позицию в заказ: выбран доступный объём и, если схема обязательна,
 * доступное молоко. Добавки необязательны всегда.
 */
export function validateSelection(cfg: ProductConfig, sel: Selection): SelectionCheck {
  if (!cfg.available) return { ok: false, reason: 'Позиция недоступна' }
  const volume = cfg.volumes.find((v) => v.id === sel.volumeId)
  if (!volume) return { ok: false, reason: 'Выберите объём' }
  if (!volume.available) return { ok: false, reason: 'Этого объёма нет в наличии' }
  if (cfg.milk?.required) {
    const milk = cfg.milk.options.find((o) => o.id === sel.milkId)
    if (!milk) return { ok: false, reason: 'Выберите молоко' }
    if (!milk.available) return { ok: false, reason: 'Это молоко закончилось' }
  }
  return { ok: true }
}

export function selectedVolume(cfg: ProductConfig, sel: Selection): VolumeOption | null {
  return cfg.volumes.find((v) => v.id === sel.volumeId) ?? null
}

export function selectedMilk(cfg: ProductConfig, sel: Selection): MilkOption | null {
  return cfg.milk?.options.find((o) => o.id === sel.milkId) ?? null
}

/** Итоговая оценка позиции: объём + молоко + добавки. Касса считает финально. */
export function selectionPrice(cfg: ProductConfig, sel: Selection): number {
  const volume = selectedVolume(cfg, sel)
  const milk = selectedMilk(cfg, sel)
  let sum = volume?.priceRub ?? cfg.priceRub
  if (milk) sum += milk.priceRub
  for (const [id, qty] of Object.entries(sel.addons)) {
    const option = findAddon(cfg, Number(id))
    if (option && !option.zeroOption && qty > 0) sum += option.priceRub * qty
  }
  return sum
}

function findAddon(cfg: ProductConfig, id: number): AddonOption | null {
  for (const g of cfg.addons ?? []) {
    const found = g.options.find((o) => o.id === id)
    if (found) return found
  }
  return null
}

/** Увеличить/уменьшить добавку: 0…maxCount, не больше доступного. */
/** Сбросить все добавки группы (выбор «Без …»). */
export function clearAddonGroup(cfg: ProductConfig, sel: Selection, groupKey: string): Selection {
  const group = (cfg.addons ?? []).find((g) => g.key === groupKey)
  if (!group) return sel
  const addons = { ...sel.addons }
  for (const o of group.options) delete addons[o.id]
  return { ...sel, addons }
}

export function bumpAddon(cfg: ProductConfig, sel: Selection, id: number, delta: number): Selection {
  const option = findAddon(cfg, id)
  if (!option || !option.available || option.zeroOption) return sel
  const next = Math.max(0, Math.min(option.maxCount, (sel.addons[id] ?? 0) + delta))
  const addons = { ...sel.addons }
  if (next === 0) delete addons[id]
  else addons[id] = next
  return { ...sel, addons }
}

/** Подпись состава «300 мл · Кокосовое · Корица · Ваниль» — как в корзине эталона. */
export function selectionText(cfg: ProductConfig, sel: Selection): string {
  const parts: string[] = []
  const volume = selectedVolume(cfg, sel)
  if (volume?.label) parts.push(volume.label)
  const milk = selectedMilk(cfg, sel)
  if (milk && (cfg.milk?.options.length ?? 0) > 1) parts.push(milk.label)
  const choice = cfg.choice?.options.find((o) => o.id === sel.choiceId)
  if (choice) parts.push(choice.label)
  for (const g of cfg.addons ?? []) {
    for (const o of g.options) {
      if (o.zeroOption) continue
      const qty = sel.addons[o.id] ?? 0
      if (qty > 0) parts.push(qty > 1 ? `${o.name} ×${qty}` : o.name)
    }
  }
  return parts.join(' · ')
}

/** Модификаторы для заказа: молоко, обязательный выбор и добавки отдельными строками. */
export function selectionModifiers(cfg: ProductConfig, sel: Selection): CartModifier[] {
  const out: CartModifier[] = []
  const milk = selectedMilk(cfg, sel)
  if (milk && milk.priceRub > 0) {
    out.push({ groupKey: 'milk', modifierId: String(milk.id), name: milk.label, price: milk.priceRub })
  }
  const choice = cfg.choice?.options.find((o) => o.id === sel.choiceId)
  if (choice) out.push({ groupKey: 'choice', modifierId: String(choice.id), name: choice.label, price: 0 })
  for (const [id, qty] of Object.entries(sel.addons)) {
    const option = findAddon(cfg, Number(id))
    if (!option || option.zeroOption || qty <= 0) continue
    for (let i = 0; i < qty; i += 1) {
      out.push({ groupKey: 'addon', modifierId: String(option.id), name: option.name, price: option.priceRub })
    }
  }
  return out
}

/** Ключ строки: одинаковый товар с разной конфигурацией не схлопывается. */
export function selectionKey(cfg: ProductConfig, sel: Selection): string {
  const addons = Object.entries(sel.addons)
    .filter(([, qty]) => qty > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, qty]) => `${id}x${qty}`)
    .join(',')
  return [cfg.productId, sel.volumeId, sel.milkId ?? '-', sel.choiceId ?? '-', addons].join('|')
}

/** Строка корзины из карточки товара. */
export function toCartLine(cfg: ProductConfig, sel: Selection, quantity = 1): CartLine {
  const volume = selectedVolume(cfg, sel)
  return {
    key: selectionKey(cfg, sel),
    productId: String(cfg.productId),
    name: volume?.label ? `${cfg.name} ${volume.label}`.trim() : cfg.name,
    quantity,
    volumeId: volume?.skuProductId != null ? String(volume.skuProductId) : undefined,
    volumeLabel: volume?.label || undefined,
    unitPriceEstimate: selectionPrice(cfg, sel),
    modifiers: selectionModifiers(cfg, sel),
    configText: selectionText(cfg, sel),
  }
}

export type ConfigResult = ProductConfig | { ok: false; error: string }

export async function fetchProductConfig(productId: number | string): Promise<ConfigResult> {
  try {
    const res = await fetch(`${base()}/api/directory/config/${encodeURIComponent(String(productId))}`)
    const data = (await res.json()) as ConfigResult
    if (res.ok && data && (data as ProductConfig).ok) return data as ProductConfig
    return { ok: false, error: String((data as { message?: string })?.message || 'Товар не найден') }
  } catch {
    return { ok: false, error: 'Нет соединения' }
  }
}

// —— Quote корзины: сумма, скидка по бонусу и подписанный расчёт ——

export type BenefitKind = 'gift' | 'voucher' | 'cashback'

export type BenefitChoice = { kind: BenefitKind; voucherId?: number | null } | null

export type QuoteAvailable = {
  gift: boolean
  cashbackRub: number
  vouchers: { id: number; title: string; kind: 'p' | 'f'; value: number; expiresDay: number }[]
}

export type QuoteResponse = {
  ok: true
  subtotal: number
  discount: number
  total: number
  benefit: { kind: BenefitKind; title: string; amountRub: number; voucherId?: number | null } | null
  available: QuoteAvailable
  quoteToken: string
  expiresAt: string
}

export type QuoteResult = QuoteResponse | { ok: false; error: string; message?: string }

/** Серверный расчёт корзины. `error` — человеческий текст или код (`benefit_stale` и т.п.). */
export async function fetchQuote(
  storeId: number,
  items: Array<{ productId: string; quantity: number; volumeId?: string | null; modifiers?: { modifierId: string }[] }>,
  benefit: BenefitChoice,
): Promise<QuoteResult> {
  try {
    const res = await fetch(`${base()}/api/orders/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOf()}` },
      body: JSON.stringify({ storeId, items, benefit }),
    })
    const data = (await res.json()) as QuoteResult
    if (res.ok && (data as QuoteResponse).ok) return data as QuoteResponse
    return { ok: false, error: String((data as { error?: string }).error || 'quote_failed'), message: (data as { message?: string }).message }
  } catch {
    return { ok: false, error: 'offline', message: 'Нет соединения' }
  }
}

const tokenOf = () => {
  try { return localStorage.getItem('sc-jwt') || '' } catch { return '' }
}

/** Человеческий текст бонуса для строки корзины/заказа. */
export function benefitLabel(b: { kind: BenefitKind; title: string; amountRub: number } | null): string {
  if (!b) return 'Без бонуса'
  if (b.kind === 'gift') return b.title || 'Подарок'
  if (b.kind === 'cashback') return `Кэшбэк −${b.amountRub} ₽`
  return `${b.title} −${b.amountRub} ₽`
}

/**
 * Восстановить выбор на карточке из строки корзины (кнопка «Изменить»).
 * Если чего-то уже нет в схеме (молоко убрали, объём кончился) — позиция открывается
 * с дефолтами, а не падает: гость увидит актуальные варианты.
 */
export function restoreSelection(cfg: ProductConfig, line: CartLine): Selection | null {
  if (!line) return null
  const base = initialSelection(cfg)
  const volume =
    (line.volumeId ? cfg.volumes.find((v) => v.skuProductId != null && String(v.skuProductId) === String(line.volumeId)) : null) ??
    cfg.volumes.find((v) => v.available) ??
    null
  const mods = line.modifiers ?? []
  const milkId = mods.find((m) => m.groupKey === 'milk')?.modifierId
  const choiceId = mods.find((m) => m.groupKey === 'choice')?.modifierId
  const addons: Record<number, number> = {}
  for (const m of mods) {
    if (m.groupKey !== 'addon') continue
    const id = Number(m.modifierId)
    if (!Number.isFinite(id)) continue
    addons[id] = (addons[id] ?? 0) + 1
  }
  const milk = milkId != null ? cfg.milk?.options.find((o) => String(o.id) === String(milkId)) : null
  const choice = choiceId != null ? cfg.choice?.options.find((o) => String(o.id) === String(choiceId)) : null
  return {
    volumeId: volume?.id ?? base.volumeId,
    milkId: milk ? milk.id : base.milkId,
    choiceId: choice ? choice.id : base.choiceId,
    addons,
  }
}
