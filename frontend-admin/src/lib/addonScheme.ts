/**
 * Схема добавок: единственный канон — `options` (modifier_scheme_options).
 * Здесь же чистые преобразования «схема из API ↔ черновик редактора», чтобы их можно было тестировать.
 */
import type { SchemeItem } from '../api/types'

export type AddonGroup = { key: string; label: string }

/** Fallback до ответа `/admin/addon-groups`: те же ключи, что отдаёт backend. */
export const ADDON_GROUPS_FALLBACK: AddonGroup[] = [
  { key: 'milk', label: 'Молоко' },
  { key: 'syrup', label: 'Сироп' },
  { key: 'sugar', label: 'Сахар' },
  { key: 'extra', label: 'Дополнительно' },
]

/** Синонимы старых схем: касса видит их одной группой extra. */
export const GROUP_KEY_NOTE = '«Топпинг» и «Другое» сохраняются как extra — на кассе это одна группа «Дополнительно».'

export type SchemeOptionDto = {
  id?: number
  schemeId?: number
  kind: 'product' | 'zero' | 'modifier'
  productId?: number | null
  modifierId?: number | null
  name?: string | null
  groupKey?: string
  isDefault?: boolean
  required?: boolean
  maxCount?: number
  priceOverride?: number | null
  sortOrder?: number
}

export type SchemeOptionDraft = {
  kind: 'product' | 'zero' | 'modifier'
  productId: number | null
  modifierId: number | null
  name: string
  groupKey: string
  isDefault: boolean
  required: boolean
  maxCount: number
  priceOverride: number | null
}

export function normalizeGroupKey(key: string | null | undefined): string {
  const k = String(key ?? '').trim().toLowerCase()
  if (k === 'milk' || k === 'молоко') return 'milk'
  if (k === 'syrup' || k === 'сироп') return 'syrup'
  if (k === 'sugar' || k === 'сахар') return 'sugar'
  return 'extra'
}

/** Лимит по умолчанию: extra — 2 разные опции, milk/syrup/sugar — одна. */
export function defaultMaxCount(groupKey: string): number {
  return normalizeGroupKey(groupKey) === 'extra' ? 2 : 1
}

/**
 * Схема из API → черновик редактора.
 * Канон — options; если у схемы только легаси items, показываем их (бэкенд сконвертирует при сохранении).
 */
export function schemeToDraft(scheme: {
  options?: SchemeOptionDto[] | null
  items?: SchemeItem[] | null
}): SchemeOptionDraft[] {
  const options = scheme.options ?? []
  if (options.length) {
    return options.map((o) => ({
      kind: o.kind,
      productId: o.productId ?? null,
      modifierId: o.modifierId ?? null,
      name: o.name ?? '',
      groupKey: normalizeGroupKey(o.groupKey),
      isDefault: !!o.isDefault,
      required: !!o.required,
      maxCount: o.maxCount ?? defaultMaxCount(o.groupKey ?? 'extra'),
      priceOverride: o.priceOverride ?? null,
    }))
  }
  return (scheme.items ?? []).map((i) => {
    const kind = i.zeroOption ? 'zero' : i.modifierId != null ? 'modifier' : 'product'
    return {
      kind,
      productId: i.productId ?? null,
      modifierId: i.modifierId ?? null,
      name: i.nameOverride ?? '',
      groupKey: normalizeGroupKey(i.groupKey),
      isDefault: !!i.isDefault,
      required: !!i.required,
      maxCount: i.maxCount ?? defaultMaxCount(i.groupKey ?? 'extra'),
      priceOverride: i.priceOverride ?? null,
    }
  })
}

/** Черновик → payload `POST /modifier-schemes` (options). required сохраняется всегда. */
export function draftToOptions(draft: SchemeOptionDraft[]) {
  return draft.map((d, idx) => ({
    kind: d.kind,
    productId: d.kind === 'zero' ? null : d.productId,
    modifierId: d.kind === 'modifier' ? d.modifierId : null,
    name: d.name.trim() || null,
    groupKey: normalizeGroupKey(d.groupKey),
    isDefault: !!d.isDefault,
    required: !!d.required,
    maxCount: Math.max(1, Number(d.maxCount) || 1),
    priceOverride: d.kind === 'zero' ? null : d.priceOverride ?? null,
    sortOrder: idx,
  }))
}

/** Группы, помеченные обязательными (бейдж в списке схем). */
export function requiredGroups(
  options: Array<{ groupKey?: string | null; required?: boolean | number }> | null | undefined,
): string[] {
  const set = new Set<string>()
  for (const o of options ?? []) if (o.required) set.add(normalizeGroupKey(o.groupKey))
  return [...set]
}
