import { describe, expect, it } from 'vitest'
import {
  defaultMapProvider,
  isMapProvider,
  placeUrl,
  routeUrl,
  schematicPoints,
  type MapProvider,
} from './mapLinks'

describe('mapProviders', () => {
  it('узнаёт только три поддерживаемых провайдера', () => {
    expect(isMapProvider('google')).toBe(true)
    expect(isMapProvider('apple')).toBe(true)
    expect(isMapProvider('yandex')).toBe(true)
    expect(isMapProvider('2gis')).toBe(false)
    expect(isMapProvider(null)).toBe(false)
  })

  it('на iPhone/iPad/Mac по умолчанию Apple, на Android и десктопе Windows — Яндекс', () => {
    expect(defaultMapProvider('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('apple')
    expect(defaultMapProvider('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('apple')
    expect(defaultMapProvider('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('yandex')
    expect(defaultMapProvider('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('yandex')
  })
})

describe('placeUrl', () => {
  const store = { name: '6.7 Coffee Ленина', address: 'Ленина 42', lat: 55.75, lng: 37.61 }

  it('с координатами ведёт на точку у каждого провайдера', () => {
    expect(placeUrl('google', store)).toContain('55.75,37.61')
    expect(placeUrl('apple', store)).toBe('https://maps.apple.com/?ll=55.75,37.61&q=6.7%20Coffee%20%D0%9B%D0%B5%D0%BD%D0%B8%D0%BD%D0%B0%2C%20%D0%9B%D0%B5%D0%BD%D0%B8%D0%BD%D0%B0%2042')
    // Яндекс принимает порядок lon,lat — иначе точка уедет.
    expect(placeUrl('yandex', store)).toContain('pt=37.61,55.75')
  })

  it('без координат ищет по адресу', () => {
    const noGeo = { name: '6.7 Coffee', address: 'Ленина 42' }
    for (const p of ['google', 'apple', 'yandex'] as MapProvider[]) {
      expect(placeUrl(p, noGeo)).toContain(encodeURIComponent('6.7 Coffee, Ленина 42'))
    }
  })
})

describe('routeUrl', () => {
  it('строит маршрут пешком и без координат падает на адрес', () => {
    const store = { name: '6.7', address: 'Ленина 42', lat: 55.75, lng: 37.61 }
    expect(routeUrl('google', store)).toContain('destination=55.75,37.61')
    expect(routeUrl('google', store)).toContain('travelmode=walking')
    expect(routeUrl('apple', store)).toContain('daddr=55.75,37.61')
    expect(routeUrl('yandex', store)).toContain('rtext=~55.75,37.61')
    expect(routeUrl('yandex', { name: '6.7', address: 'Ленина 42' })).toContain('text=')
  })
})

describe('schematicPoints', () => {
  it('нормализует координаты в квадрат с отступами', () => {
    const stores = [
      { id: 1, name: 'A', address: 'a', lat: 55.7, lng: 37.5 },
      { id: 2, name: 'B', address: 'b', lat: 55.8, lng: 37.7 },
    ]
    const pts = schematicPoints(stores)
    expect(pts).toHaveLength(2)
    // Самая западная — слева, самая южная — снизу (ось Y в SVG растёт вниз).
    expect(pts[0].x).toBeCloseTo(0.12, 5)
    expect(pts[1].x).toBeCloseTo(0.88, 5)
    expect(pts[0].y).toBeCloseTo(0.88, 5)
    expect(pts[1].y).toBeCloseTo(0.12, 5)
  })

  it('одну точку и точки без координат ставит в центр', () => {
    expect(schematicPoints([{ id: 1, name: 'A', address: 'a', lat: 55.7, lng: 37.5 }])[0]).toMatchObject({ x: 0.5, y: 0.5 })
    expect(schematicPoints([{ id: 1, name: 'A', address: 'a' }, { id: 2, name: 'B', address: 'b' }]).every((p) => p.x === 0.5)).toBe(true)
  })
})
