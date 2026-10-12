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

/** Главная фраза под кружками: что делать дальше. */
export function progressPhrase(opts: { n: number; left: number; freeAvailable: number }): string {
  const { n, left, freeAvailable } = opts
  if (freeAvailable > 0) return `Подарок: ${freeAvailable} ${drinksWord(freeAvailable)} — скажите бариста`
  if (left > 0) return `Ещё ${left} ${cupsWord(left)} до бесплатного`
  return `Купите ${n} ${cupsWord(n)} — следующий в подарок`
}
