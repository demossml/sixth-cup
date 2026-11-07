/**
 * Координаты точки из ссылки на карту или из строки «широта, долгота».
 *
 * Владелец копирует ссылку из Яндекс/Google/Apple карт, а не вводит числа руками:
 * опечатка в одном знаке уводит точку на другой конец города.
 *
 * Порядок чисел зависит от карты: Яндекс в `pt`/`ll` пишет «долгота, широта»,
 * Apple и Google — «широта, долгота».
 */

export type Coords = { lat: number; lng: number }

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)'

const okLat = (n: number) => Number.isFinite(n) && Math.abs(n) <= 90
const okLng = (n: number) => Number.isFinite(n) && Math.abs(n) <= 180
const isZero = (c: Coords) => c.lat === 0 && c.lng === 0

/**
 * Достаёт координаты из:
 *  • «55.7558, 37.6173» (широта, долгота);
 *  • `yandex.ru/maps/?pt=37.6173,55.7558` / `?ll=…` / `?text=55.75,37.61`;
 *  • `google.com/maps/@55.7558,37.6173,17z` / `?q=…` / `!3d55.75!4d37.61`;
 *  • `maps.apple.com/?ll=55.7558,37.6173` / `?daddr=…`.
 */
export function parseCoords(input: string): Coords | null {
  const s = (input || '').trim()
  if (!s) return null
  const isYandex = /yandex\./i.test(s)

  // 1. Яндекс: pt/ll — сначала долгота.
  if (isYandex) {
    const m = new RegExp(`[?&](?:pt|ll)=${NUM}(?:,|%2C)${NUM}`, 'i').exec(s)
    if (m) {
      const lng = Number(m[1])
      const lat = Number(m[2])
      if (okLat(lat) && okLng(lng)) return { lat, lng }
    }
  }

  // 2. Google: !3d<lat>!4d<lng> — самое точное в ссылке на место.
  const g3d4d = new RegExp(`!3d${NUM}!4d${NUM}`).exec(s)
  if (g3d4d) {
    const lat = Number(g3d4d[1])
    const lng = Number(g3d4d[2])
    if (okLat(lat) && okLng(lng)) return { lat, lng }
  }

  // 3. Google: /@lat,lng,17z
  const at = new RegExp(`@${NUM},${NUM}`).exec(s)
  if (at) {
    const lat = Number(at[1])
    const lng = Number(at[2])
    if (okLat(lat) && okLng(lng)) return { lat, lng }
  }

  // 4. Параметры ?q= / ?ll= / ?daddr= / ?destination= — широта, долгота.
  const q = new RegExp(`[?&](?:q|query|ll|daddr|destination|center|text)=${NUM}(?:,|%2C)${NUM}`, 'i').exec(s)
  if (q) {
    const a = Number(q[1])
    const b = Number(q[2])
    // Если первое число не может быть широтой — порядок перевёрнут.
    const c = okLat(a) ? { lat: a, lng: b } : { lat: b, lng: a }
    if (okLat(c.lat) && okLng(c.lng) && !isZero(c)) return c
  }

  // 5. Просто числа: «55.7558, 37.6173» (запятая, точка с запятой или пробел).
  const plain = new RegExp(`^${NUM}\\s*[,;]?\\s*${NUM}$`).exec(s)
  if (plain) {
    const a = Number(plain[1])
    const b = Number(plain[2])
    const c = okLat(a) ? { lat: a, lng: b } : { lat: b, lng: a }
    if (okLat(c.lat) && okLng(c.lng) && !isZero(c)) return c
  }

  return null
}

/** Числа для полей ввода: 6 знаков — это ~11 см, больше для кофейни не нужно. */
export const fmtCoord = (n: number): string => n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
