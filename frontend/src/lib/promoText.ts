/**
 * Текст акции: в админке владелец часто оставляет `title` пустым, а весь текст
 * (включая список «Условия • …») кладёт в `body`. В PWA это выглядело так:
 * заголовок — обрезанный по букве `body` («…Закажите два л»), блока «Условия» нет.
 *
 * Здесь текст разбирается по смыслу, без правок данных в проде:
 *  • заголовок берём из `title`/`subtitle`, иначе — первое предложение;
 *  • «Условия» отделяем от описания и превращаем пункты «•» в список.
 */

const TERMS_MARKER = /(?:^|[\s\n])условия\s*(?:[:•\-—]|\n)?\s*/i

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Пункты списка: разделитель «•», перевод строки или «;». */
function splitItems(raw: string): string[] {
  return raw
    .split(/[•·\n]|;\s*/)
    .map((x) => clean(x).replace(/^[-–—]\s*/, ''))
    .filter((x) => x.length > 0)
}

export type PromoText = {
  /** Заголовок экрана: никогда не «обрезанный по букве» текст. */
  title: string
  /** Описание без блока условий. */
  lead: string
  /** Пункты условий (пустой массив — условий нет). */
  terms: string[]
}

/** Обрезать по границе слова, чтобы не рвать слово посередине. */
function cutWords(text: string, max: number): string {
  if (text.length <= max) return text
  const slice = text.slice(0, max)
  const at = slice.lastIndexOf(' ')
  return `${(at > max * 0.6 ? slice.slice(0, at) : slice).trim()}…`
}

export function promoText(input: {
  title?: string | null
  subtitle?: string | null
  body?: string | null
  terms?: string | null
}): PromoText {
  const body = String(input.body ?? '').trim()
  const marker = body.match(TERMS_MARKER)
  const idx = marker?.index ?? -1

  let lead = body
  let rawTerms = String(input.terms ?? '').trim()
  if (idx >= 0) {
    lead = body.slice(0, idx).trim()
    if (!rawTerms) rawTerms = body.slice(idx + (marker?.[0]?.length ?? 0)).trim()
  }
  // Хвост «Условия» мог остаться после явного `terms` — убираем маркер из описания.
  lead = clean(lead).replace(/[•·\-–—]+$/, '').trim()

  const firstSentence = lead.split(/(?<=[.!?])\s/)[0] ?? ''
  const explicitTitle = clean(String(input.title ?? ''))
  const subtitleTitle = clean(String(input.subtitle ?? '').split('\n')[0] ?? '')
  const derived = clean(firstSentence).replace(/[.!?]+$/, '')
  const title = explicitTitle || subtitleTitle || cutWords(derived, 64) || 'Акция'

  // Заголовок взят из body — значит первое предложение уже показано в заголовке и в описании не нужно.
  const fromBody = !explicitTitle && !subtitleTitle
  const rest = fromBody && lead.startsWith(firstSentence) ? lead.slice(firstSentence.length).trim() : lead
  const terms = rawTerms ? splitItems(rawTerms) : []
  const leadOut = clean(rest)

  return { title, lead: leadOut, terms }
}
