/**
 * Черновик шаблона ваучера и его валидация на клиенте.
 * Правила те же, что у сервера (`templateCreateZ` / `templatePatchZ`), но проверяются
 * до отправки — админ видит понятный текст, а не 400 после нажатия «Сохранить».
 */
export type TemplateDraft = {
  id?: number
  code: string
  title: string
  kind: 'percent' | 'fixed'
  value: number
  validDays: number
  imageUrl: string
  redemptionMode: 'once' | 'multi'
  maxPerDay: string
  maxTotal: string
  stackableWithFreeCup: boolean
  active: boolean
}

export const emptyDraft = (): TemplateDraft => ({
  code: '',
  title: '',
  kind: 'percent',
  value: 10,
  validDays: 30,
  imageUrl: '',
  redemptionMode: 'once',
  maxPerDay: '',
  maxTotal: '',
  stackableWithFreeCup: true,
  active: true,
})

export const draftFrom = (t: {
  id: number
  code: string
  title: string
  kind: string
  value: number
  validDays: number
  imageUrl?: string | null
  redemptionMode?: string
  maxPerDay?: number | null
  maxTotal?: number | null
  stackableWithFreeCup?: boolean
  active?: boolean
}): TemplateDraft => ({
  id: t.id,
  code: t.code,
  title: t.title,
  kind: t.kind === 'fixed' ? 'fixed' : 'percent',
  value: t.value,
  validDays: t.validDays,
  imageUrl: t.imageUrl ?? '',
  redemptionMode: t.redemptionMode === 'multi' ? 'multi' : 'once',
  maxPerDay: t.maxPerDay == null ? '' : String(t.maxPerDay),
  maxTotal: t.maxTotal == null ? '' : String(t.maxTotal),
  stackableWithFreeCup: t.stackableWithFreeCup !== false,
  active: t.active !== false,
})

const imageUrlOk = (v: string) => !v || v.startsWith('/uploads/') || /^https?:\/\//i.test(v)

/** null — можно сохранять; строка — что именно не так. */
export function draftError(d: TemplateDraft): string | null {
  if (!d.id && !d.code.trim()) return 'Укажите код шаблона'
  if (!d.title.trim()) return 'Укажите название'
  if (!(d.value > 0)) return 'Значение должно быть больше нуля'
  if (d.kind === 'percent' && d.value > 100) return 'Процент не может быть больше 100'
  if (!(d.validDays >= 1)) return 'Срок действия — минимум 1 день'
  if (d.validDays > 3650) return 'Срок действия — не больше 10 лет'
  if (!imageUrlOk(d.imageUrl.trim())) return 'Картинка: /uploads/… или https://…'
  if (d.maxPerDay && !(Number(d.maxPerDay) >= 1)) return 'Лимит в сутки — минимум 1'
  if (d.maxTotal && !(Number(d.maxTotal) >= 1)) return 'Общий лимит — минимум 1'
  return null
}

const limit = (v: string): number | null => (v.trim() === '' ? null : Number(v))

export function createBody(d: TemplateDraft) {
  return {
    code: d.code.trim().toUpperCase(),
    title: d.title.trim(),
    kind: d.kind,
    value: d.value,
    validDays: d.validDays,
    active: d.active,
    imageUrl: d.imageUrl.trim() || null,
    redemptionMode: d.redemptionMode,
    maxPerDay: limit(d.maxPerDay),
    maxTotal: limit(d.maxTotal),
    stackableWithFreeCup: d.stackableWithFreeCup,
  }
}

/** Код шаблона неизменяем: PATCH его не принимает. */
export function patchBody(d: TemplateDraft) {
  const b = createBody(d)
  return {
    title: b.title,
    kind: b.kind,
    value: b.value,
    validDays: b.validDays,
    active: b.active,
    imageUrl: b.imageUrl,
    redemptionMode: b.redemptionMode,
    maxPerDay: b.maxPerDay,
    maxTotal: b.maxTotal,
    stackableWithFreeCup: b.stackableWithFreeCup,
  }
}
