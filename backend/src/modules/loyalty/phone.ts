/**
 * Телефон гостя: нормализация РФ и маска для кассы/админки.
 *
 * Кассир вводит номер так, как удобно: `9XXXXXXXXX`, `+7 999 123-45-67`, `8 (999) …`.
 * Внутри — всегда 11 цифр, начиная с `7`. Псевдо-номера гостя без телефона имеют вид
 * `guest:<hex>` (`auth/service.ts`) и настоящими телефонами не считаются.
 */

/** Только цифры из ввода. */
const digitsOf = (input: string) => String(input ?? '').replace(/\D+/g, '')

/** `guest:<hex>` — техническое значение для гостя без телефона. */
export function isGuestPhone(phone: string | null | undefined): boolean {
  return String(phone ?? '').startsWith('guest:')
}

/**
 * Нормализует телефон РФ в 11 цифр (`7XXXXXXXXXX`).
 * Возвращает `null`, если номер не похож на российский мобильный/городской.
 */
export function normalizePhoneRu(input: string | null | undefined): string | null {
  const raw = String(input ?? '').trim()
  if (!raw || isGuestPhone(raw)) return null
  let d = digitsOf(raw)
  if (!d) return null
  // Отбрасываем международный префикс 00.
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 && d.startsWith('9')) d = `7${d}`
  else if (d.length === 11 && (d.startsWith('8') || d.startsWith('7'))) d = `7${d.slice(1)}`
  else if (d.length === 11 && !d.startsWith('7')) return null
  if (d.length !== 11 || !d.startsWith('7')) return null
  // Код оператора/города: 3 цифры после 7, не начинается с 0 или 1.
  if (/^[01]/.test(d.slice(1, 4))) return null
  return d
}

/** Маска для показа: `+7 ••• ••• 12 34`. */
export function maskPhone(phone: string | null | undefined): string {
  const norm = normalizePhoneRu(phone)
  if (!norm) return ''
  const rest = norm.slice(1)
  return `+7 ••• ••• ${rest.slice(6, 8)} ${rest.slice(8, 10)}`
}

/** Подпись для гостя, созданного по телефону: `+7 ••• ••• 12 34`. */
export function nicknameFromPhone(phone: string): string {
  return maskPhone(phone) || 'Гость'
}

/** Сравнение номеров без учёта формата ввода. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhoneRu(a)
  const nb = normalizePhoneRu(b)
  return na != null && nb != null && na === nb
}
