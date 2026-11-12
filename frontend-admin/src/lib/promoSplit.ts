/**
 * «Разложить текст по полям» — разбор склейки из аудита F-01.
 *
 * Владелец вставлял в одно поле весь блок вместе с подписями формы:
 * «Утро −30% Краткое описание Средний капучино со скидкой 30% Полное описание
 * для карточки Каждый день до 12:00…». Функция находит подписи (они могут быть
 * в одной строке, а не только с новой), режет текст по ним и раскладывает:
 *
 *   Название / Заголовок        → title
 *   Краткое / Короткое описание → subtitle
 *   Полное описание (для карточки) → body
 *   Условия                     → terms
 *
 * Текст до первой подписи считается заголовком. Ничего не сохраняем — только
 * заполняем поля формы, владелец проверяет и нажимает «Сохранить».
 */
export type SplitField = 'title' | 'subtitle' | 'body' | 'terms'

export type SplitResult = {
  title: string
  subtitle: string
  body: string
  terms: string
  /** Найдена хотя бы одна подпись — значит было что раскладывать. */
  found: boolean
}

type Label = { re: RegExp; field: SplitField }

// Порядок важен: длинные подписи проверяем раньше коротких, чтобы
// «Полное описание для карточки» не распозналось как «Полное описание».
const LABELS: Label[] = [
  { re: /полное\s+описание\s+для\s+карточки/gi, field: 'body' },
  { re: /полное\s+описание/gi, field: 'body' },
  { re: /краткое\s+описание/gi, field: 'subtitle' },
  { re: /короткое\s+описание/gi, field: 'subtitle' },
  { re: /условия/gi, field: 'terms' },
  { re: /название/gi, field: 'title' },
  { re: /заголовок/gi, field: 'title' },
]

const clean = (s: string) =>
  s
    .replace(/^\s*[:\-—–.]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Есть ли в тексте подписи полей — для включения кнопки и предупреждения. */
export function hasFieldLabels(text: string | null | undefined): boolean {
  if (!text) return false
  return LABELS.some(({ re }) => {
    re.lastIndex = 0
    return re.test(text)
  })
}

export function splitPromoText(blob: string | null | undefined): SplitResult {
  const src = (blob ?? '').replace(/\r\n/g, '\n')
  const marks: Array<{ index: number; end: number; field: SplitField }> = []

  for (const { re, field } of LABELS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      marks.push({ index: m.index, end: m.index + m[0].length, field })
      if (m[0].length === 0) break // защита от бесконечного цикла
    }
  }

  if (marks.length === 0) {
    return { title: clean(src), subtitle: '', body: '', terms: '', found: false }
  }

  marks.sort((a, b) => a.index - b.index || b.end - a.end)

  // Перекрывающиеся совпадения отбрасываем: остаётся самое длинное в позиции.
  const kept: typeof marks = []
  for (const m of marks) {
    const last = kept[kept.length - 1]
    if (last && m.index < last.end) continue
    kept.push(m)
  }

  const out: Record<SplitField, string[]> = { title: [], subtitle: [], body: [], terms: [] }

  const lead = clean(src.slice(0, kept[0].index))
  if (lead) out.title.push(lead)

  for (let i = 0; i < kept.length; i++) {
    const cur = kept[i]
    const next = kept[i + 1]
    const value = clean(src.slice(cur.end, next ? next.index : src.length))
    if (value) out[cur.field].push(value)
  }

  const join = (parts: string[]) => parts.filter(Boolean).join(' ').trim()

  return {
    title: join(out.title),
    subtitle: join(out.subtitle),
    body: join(out.body),
    terms: join(out.terms),
    found: true,
  }
}
