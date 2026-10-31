/**
 * Черновик схемы объёмов и его клиентская валидация.
 * Те же правила проверяет сервер (`volumeScheme.ts` в backend) — здесь, чтобы ошибка
 * появлялась до сохранения и рядом с полями.
 */
import type { VolumeScheme } from '../api/types'

export type VolumeDraftItem = {
  id?: number
  label: string
  sizeValue: number | null
  sizeUnit: 'ml' | 'g' | null
  sortOrder: number
  active: boolean
}

export type VolumeDraft = {
  id?: number
  name: string
  active: boolean
  items: VolumeDraftItem[]
}

export const volumeDraftFrom = (s?: VolumeScheme): VolumeDraft => s
  ? {
      id: s.id,
      name: s.name,
      active: s.active,
      items: s.items.map((it) => ({
        id: it.id,
        label: it.label,
        sizeValue: it.sizeValue,
        sizeUnit: it.sizeUnit,
        sortOrder: it.sortOrder,
        active: it.active,
      })),
    }
  : {
      name: '',
      active: true,
      items: [
        { label: '200 мл', sizeValue: 200, sizeUnit: 'ml', sortOrder: 0, active: true },
        { label: '300 мл', sizeValue: 300, sizeUnit: 'ml', sortOrder: 1, active: true },
        { label: '400 мл', sizeValue: 400, sizeUnit: 'ml', sortOrder: 2, active: true },
      ],
    }

/** null — можно сохранять; строка — что именно не так. */
export function volumeDraftError(d: VolumeDraft): string | null {
  if (!d.name.trim()) return 'Укажите название схемы'
  if (!d.items.length) return 'Добавьте хотя бы один объём'
  const seen = new Set<string>()
  for (const it of d.items) {
    if (!it.label.trim()) return 'У каждого объёма должно быть название'
    const key = it.label.trim().toLowerCase().replace(/\s+/g, '')
    if (seen.has(key)) return `Объём «${it.label.trim()}» указан дважды`
    seen.add(key)
    if ((it.sizeValue == null) !== (it.sizeUnit == null)) return `«${it.label.trim()}»: укажите и число, и единицу (мл/г)`
  }
  return null
}
