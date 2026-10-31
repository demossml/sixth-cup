/**
 * Черновик схемы молока и его клиентская валидация.
 * Те же правила проверяет сервер (`milkScheme.ts` в backend) — здесь, чтобы ошибка
 * появлялась до сохранения и рядом с полями.
 */
import type { MilkScheme } from '../api/types'

export type MilkDraftVariant = {
  id?: number
  productId: number | null
  label: string
  isDefault: boolean
  isFree: boolean
  sendToReceipt: boolean
  sortOrder: number
  active: boolean
}

export type MilkDraft = {
  id?: number
  name: string
  active: boolean
  variants: MilkDraftVariant[]
}

export const milkDraftFrom = (s?: MilkScheme): MilkDraft => s
  ? {
      id: s.id,
      name: s.name,
      active: s.active,
      variants: s.variants.map((v) => ({
        id: v.id,
        productId: v.productId,
        label: v.label,
        isDefault: v.isDefault,
        isFree: v.isFree,
        sendToReceipt: v.sendToReceipt,
        sortOrder: v.sortOrder,
        active: v.active,
      })),
    }
  : {
      name: '',
      active: true,
      variants: [
        { productId: null, label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false, sortOrder: 0, active: true },
        { productId: null, label: 'Кокосовое молоко', isDefault: false, isFree: false, sendToReceipt: true, sortOrder: 1, active: true },
      ],
    }

/** null — можно сохранять; строка — что именно не так. */
export function milkDraftError(d: MilkDraft, nameOf: (id: number | null) => string | undefined): string | null {
  if (!d.name.trim()) return 'Укажите название схемы'
  if (!d.variants.length) return 'Добавьте хотя бы один вариант молока'
  if (d.variants.filter((v) => v.isDefault && v.active).length > 1) return 'Вариант по умолчанию может быть только один'
  for (const v of d.variants) {
    if (!v.label.trim()) return 'У каждого варианта должно быть название'
    if (v.isFree && v.sendToReceipt) return `«${v.label}»: бесплатный вариант не может уходить в чек`
    if (v.sendToReceipt && v.productId == null) return `«${v.label}»: выберите товар Эвотор для платного варианта`
    if (v.productId != null && !nameOf(v.productId)) return `«${v.label}»: товар не найден`
  }
  const used = d.variants.filter((v) => v.productId != null).map((v) => v.productId!)
  if (new Set(used).size !== used.length) return 'Один товар не может быть привязан к двум вариантам'
  return null
}
