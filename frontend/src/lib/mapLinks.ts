/**
 * Внешние карты: гость сам выбирает Google / Apple / Яндекс (решение владельца).
 * Своя схема города рисуется в приложении, а «Маршрут» отдаём в выбранную карту.
 */

export type MapProvider = 'google' | 'apple' | 'yandex'

export const MAP_PROVIDERS: { id: MapProvider; label: string; short: string }[] = [
  { id: 'google', label: 'Google Карты', short: 'Google' },
  { id: 'apple', label: 'Apple Карты', short: 'Apple' },
  { id: 'yandex', label: 'Яндекс Карты', short: 'Яндекс' },
]

export const MAP_PROVIDER_KEY = 'sc_map_provider'

export const isMapProvider = (v: unknown): v is MapProvider =>
  v === 'google' || v === 'apple' || v === 'yandex'

/**
 * Провайдер по умолчанию: на iPhone/iPad/Mac — Apple, иначе Яндекс (аудитория в РФ).
 * Выбор гостя всегда важнее автоопределения.
 */
export function defaultMapProvider(ua: string): MapProvider {
  const s = ua.toLowerCase()
  if (/iphone|ipad|ipod|macintosh|mac os x/.test(s)) return 'apple'
  return 'yandex'
}

export function readMapProvider(): MapProvider | null {
  try {
    const v = localStorage.getItem(MAP_PROVIDER_KEY)
    return isMapProvider(v) ? v : null
  } catch {
    return null
  }
}

export function saveMapProvider(p: MapProvider): void {
  try {
    localStorage.setItem(MAP_PROVIDER_KEY, p)
  } catch {
    /* приватный режим — просто не запомним */
  }
}

export type MapTarget = {
  name?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
}

const hasCoords = (t: MapTarget): t is MapTarget & { lat: number; lng: number } =>
  typeof t.lat === 'number' && typeof t.lng === 'number' && Number.isFinite(t.lat) && Number.isFinite(t.lng)

const query = (t: MapTarget): string => [t.name, t.address].filter(Boolean).join(', ') || '6.7 Coffee'

/**
 * Ссылка на карточку точки. Координаты точнее адреса, поэтому используем их, если они есть;
 * без координат — поиск по адресу (точку всё равно можно найти).
 */
export function placeUrl(provider: MapProvider, t: MapTarget): string {
  const q = encodeURIComponent(query(t))
  if (provider === 'google') {
    return hasCoords(t)
      ? `https://www.google.com/maps/search/?api=1&query=${t.lat},${t.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`
  }
  if (provider === 'apple') {
    return hasCoords(t) ? `https://maps.apple.com/?ll=${t.lat},${t.lng}&q=${q}` : `https://maps.apple.com/?q=${q}`
  }
  return hasCoords(t) ? `https://yandex.ru/maps/?pt=${t.lng},${t.lat}&z=17&text=${q}` : `https://yandex.ru/maps/?text=${q}`
}

/** Маршрут «откуда я — до кофейни». Яндекс требует `rtext=~lat,lon` (сначала пустая точка «я»). */
export function routeUrl(provider: MapProvider, t: MapTarget): string {
  const q = encodeURIComponent(query(t))
  if (provider === 'google') {
    return hasCoords(t)
      ? `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}&travelmode=walking`
      : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`
  }
  if (provider === 'apple') {
    return hasCoords(t) ? `https://maps.apple.com/?daddr=${t.lat},${t.lng}&dirflg=w` : `https://maps.apple.com/?daddr=${q}&dirflg=w`
  }
  return hasCoords(t)
    ? `https://yandex.ru/maps/?rtext=~${t.lat},${t.lng}&rtt=pd`
    : `https://yandex.ru/maps/?text=${q}&rtt=pd`
}

/**
 * Позиции точек на схематичной карте: нормализуем координаты в 0…1 внутри квадрата
 * с отступами (12 %), чтобы крайние точки не прилипали к рамке.
 */
export function schematicPoints<T extends MapTarget>(stores: T[]): { store: T; x: number; y: number }[] {
  const geo: { store: T; lat: number; lng: number }[] = []
  for (const store of stores) {
    if (hasCoords(store)) geo.push({ store, lat: store.lat, lng: store.lng })
  }
  if (geo.length < 2) {
    // Одна точка (или координат нет) — ставим по центру: схема остаётся читаемой.
    return stores.map((store) => ({ store, x: 0.5, y: 0.5 }))
  }
  const lats = geo.map((s) => s.lat)
  const lngs = geo.map((s) => s.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const spanLat = maxLat - minLat || 1
  const spanLng = maxLng - minLng || 1
  const out: { store: T; x: number; y: number }[] = []
  for (const store of stores) {
    if (!hasCoords(store)) {
      out.push({ store, x: 0.5, y: 0.5 })
      continue
    }
    const x = 0.12 + ((store.lng - minLng) / spanLng) * 0.76
    // Широта растёт вверх, а ось Y в SVG — вниз.
    const y = 0.12 + (1 - (store.lat - minLat) / spanLat) * 0.76
    out.push({ store, x, y })
  }
  return out
}
