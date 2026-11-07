/**
 * Черновик схемы обязательного выбора (корица и т.п.) и клиентская валидация.
 * Правила совпадают с серверными (`choiceScheme.ts` в backend).
 */
import type { ChoiceScheme } from '../api/types'

export const CHOICE_LABEL_MAX = 24

export type ChoiceDraftOption = {
  id?: number
  label: string
  isDefault: boolean
  sortOrder: number
  active: boolean
}

export type ChoiceDraft = {
  id?: number
  name: string
  title: string
  active: boolean
  options: ChoiceDraftOption[]
}

export const choiceDraftFrom = (s?: ChoiceScheme): ChoiceDraft => s
  ? {
      id: s.id,
      name: s.name,
      title: s.title,
      active: s.active,
      options: s.options.map((o) => ({ id: o.id, label: o.label, isDefault: o.isDefault, sortOrder: o.sortOrder, active: o.active })),
    }
  : {
      name: '',
      title: 'Корица',
      active: true,
      options: [
        { label: 'С корицей', isDefault: false, sortOrder: 0, active: true },
        { label: 'Без корицы', isDefault: false, sortOrder: 1, active: true },
      ],
    }

/** null — можно сохранять; строка — что именно не так. */
export function choiceDraftError(d: ChoiceDraft): string | null {
  if (!d.name.trim()) return 'Укажите название схемы'
  const title = d.title.trim()
  if (!title) return 'Укажите заголовок на кассе'
  if (title.length > CHOICE_LABEL_MAX) return `Заголовок — не длиннее ${CHOICE_LABEL_MAX} символов`
  for (const o of d.options) {
    const l = o.label.trim()
    if (!l) return 'У каждого варианта должно быть название'
    if (l.length > CHOICE_LABEL_MAX) return `«${l}»: не длиннее ${CHOICE_LABEL_MAX} символов`
  }
  const active = d.options.filter((o) => o.active)
  if (active.length < 2) return 'Нужно минимум два активных варианта'
  const labels = d.options.map((o) => o.label.trim().toLowerCase())
  if (new Set(labels).size !== labels.length) return 'Названия вариантов не должны повторяться'
  if (d.options.filter((o) => o.isDefault && o.active).length > 1) return 'Вариант по умолчанию может быть только один'
  return null
}
