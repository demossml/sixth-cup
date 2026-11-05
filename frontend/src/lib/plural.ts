/** Русские числительные: 1 стакан / 2–4 стакана / 5–20 стаканов (11–14 — всегда «много»). */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

export const cupsWord = (n: number) => pluralRu(n, 'стакан', 'стакана', 'стаканов')
export const drinksWord = (n: number) => pluralRu(n, 'напиток', 'напитка', 'напитков')
export const friendsWord = (n: number) => pluralRu(n, 'друг', 'друга', 'друзей')

/**
 * Фраза прогресса по PROGRESS-STICKERS-SPEC.
 * Только «стаканы», без смешения с «чашками».
 *  • подарок доступен → «Все 5 стаканов собраны»;
 *  • ни одной марки → «6-й стакан — в подарок»;
 *  • иначе → «Ещё N стакана/стаканов до подарка».
 */
export function progressPhrase(opts: { n: number; marks: number; freeAvailable: number }): string {
  const { n, marks, freeAvailable } = opts
  if (freeAvailable > 0) return `Все ${n} ${cupsWord(n)} собраны`
  if (marks <= 0) return `${n + 1}-й стакан — в подарок`
  const left = Math.max(0, n - marks)
  if (left <= 0) return `Все ${n} ${cupsWord(n)} собраны`
  return `Ещё ${left} ${cupsWord(left)} до подарка`
}
