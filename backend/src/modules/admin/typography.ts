/**
 * Типографика для печати (зеркало клиентского `typography.ts`).
 *
 * Неразрывный пробел не даёт единице измерения, тире и кавычке оказаться в начале
 * строки. Правила обязаны совпадать с клиентом: иначе холст и PDF разойдутся.
 */
const NBSP = '\u00A0'

export function typograph(input: string | null | undefined): string {
  if (!input) return ''
  let t = input
  t = t.replace(/(\d)\s+(мл|л|г|кг|шт|порц|руб|₽)/gi, `$1${NBSP}$2`)
  t = t.replace(/\s+«/g, `${NBSP}«`)
  t = t.replace(/«\s+/g, '«')
  t = t.replace(/\s+»/g, '»')
  t = t.replace(/»\s+/g, `»${NBSP}`)
  t = t.replace(/\s+\(/g, `${NBSP}(`)
  t = t.replace(/\s+—\s+/g, `${NBSP}— `)
  return t.replace(/^ +| +$/g, '')
}
