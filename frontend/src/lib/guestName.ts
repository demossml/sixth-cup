/**
 * Аудит главной F-08: бэкенд выдаёт никнейм `Гость I7WFJD` — для гостя это выглядит
 * как непонятный код. Показываем просто «Гость», а номер карты и так рядом.
 */
export function displayNickname(nickname: string | null | undefined): string {
  const nick = (nickname ?? '').trim()
  if (!nick) return 'Гость'
  // «Гость AB12CD», «гость ab12cd» → «Гость».
  // ВАЖНО: `\b` в JS работает только с латиницей, для кириллицы нужен явный разделитель.
  if (/^гость(\s|$)/i.test(nick)) return 'Гость'
  return nick
}
