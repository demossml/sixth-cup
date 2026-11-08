/**
 * Встроенная карта без ключей API, аккаунтов и лицензий (требование владельца: только бесплатно).
 *
 * Источник — официальный виджет Яндекс.Карт (`map-widget`, его же отдаёт «Конструктор карт»).
 * Ключ не нужен, ограничений по показам нет, виджет отдаёт несколько точек сразу и сам рисует
 * подписи, зум и «открыть в Яндекс Картах».
 *
 * Почему не Google: `output=embed` без ключа сейчас перенаправляет на Embed API, которому нужен
 * проект в Google Cloud с платёжным аккаунтом. Apple бесплатного веб-виджета не имеет.
 * Выбор провайдера в интерфейсе по-прежнему управляет тем, в какое приложение отдавать маршрут.
 */

export type EmbedTarget = { name?: string | null; address?: string | null; lat?: number | null; lng?: number | null }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const hasCoords = (t: EmbedTarget): t is EmbedTarget & { lat: number; lng: number } =>
  isNum(t.lat) && isNum(t.lng)

/** Координаты без экспоненты и хвостовых нулей — так их понимает виджет. */
export const coord = (v: number): string => v.toFixed(6).replace(/\.?0+$/, '')

/** Размер видимой области iframe на телефоне: по нему подбираем зум, чтобы все точки влезли. */
const VIEW_PX = { width: 340, height: 190 }

const metersPerPixel = (lat: number, zoom: number): number =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom

/** Центр и зум по всем точкам: без выделенной кофейни хотим видеть все точки, а не первую. */
function fitAll(points: { lat: number; lng: number }[]): { lat: number; lng: number; zoom: number } {
  const lat = points.reduce((a, p) => a + p.lat, 0) / points.length
  const lng = points.reduce((a, p) => a + p.lng, 0) / points.length
  const spanLat = Math.max(...points.map((p) => Math.abs(p.lat - lat))) * 2 * 111_000
  const spanLng = Math.max(...points.map((p) => Math.abs(p.lng - lng))) * 2 * 111_000 * Math.cos((lat * Math.PI) / 180)
  // Запас 1.4 — чтобы метки не липли к краям.
  const needX = spanLng * 1.4
  const needY = spanLat * 1.4
  let zoom = 16
  while (zoom > 10) {
    const mpp = metersPerPixel(lat, zoom)
    if (needX <= VIEW_PX.width * mpp && needY <= VIEW_PX.height * mpp) break
    zoom -= 1
  }
  return { lat, lng, zoom }
}

/**
 * URL карты для iframe. `null` — ни у одной точки нет координат: тогда показываем схему,
 * потому что карта «по адресу» угадывает место и вводит гостя в заблуждение.
 */
export function mapEmbedUrl(stores: EmbedTarget[], selected: EmbedTarget | null, zoom = 16): string | null {
  const points = stores.filter(hasCoords)
  if (points.length === 0) return null
  const chosen = selected && hasCoords(selected) ? selected : null
  const view = chosen ? { lat: chosen.lat, lng: chosen.lng, zoom } : fitAll(points)
  const marks = points.map((s) => `${coord(s.lng)},${coord(s.lat)}`).join('~')
  return `https://yandex.ru/map-widget/v1/?ll=${coord(view.lng)},${coord(view.lat)}&z=${view.zoom}&pt=${marks}&lang=ru_RU`
}

/** Есть ли что показывать на настоящей карте (иначе остаётся схема). */
export const canEmbedMap = (stores: EmbedTarget[]): boolean => stores.some(hasCoords)
