import { describe, expect, it } from 'vitest'
import { canEmbedMap, coord, mapEmbedUrl } from './mapEmbed'

const a = { name: 'Кофейня на Ленина', address: 'ул. Ленина, 1', lat: 54.7104, lng: 20.4522 }
const b = { name: 'Кофейня у вокзала', address: 'пл. Победы, 3', lat: 54.7215, lng: 20.4974 }
const noCoords = { name: 'Без координат', address: 'адрес', lat: null, lng: null }

describe('встроенная карта (бесплатный виджет Яндекса)', () => {
  it('координаты в понятном виде', () => {
    expect(coord(54.71)).toBe('54.71')
    expect(coord(20.4522)).toBe('20.4522')
    expect(coord(0)).toBe('0')
  })

  it('все точки на карте, центр — выбранная кофейня и крупный зум', () => {
    const url = mapEmbedUrl([a, b], a)!
    expect(url.startsWith('https://yandex.ru/map-widget/v1/?')).toBe(true)
    expect(url).toContain('ll=20.4522,54.7104')
    expect(url).toContain('z=16')
    expect(url).toContain('pt=20.4522,54.7104~20.4974,54.7215')
    expect(url).toContain('lang=ru_RU')
  })

  it('без выбранной кофейни кадр охватывает все точки', () => {
    const far = { lat: 54.9, lng: 20.9 }
    const url = mapEmbedUrl([a, far], null)!
    const z = Number(new URL(url).searchParams.get('z'))
    expect(z).toBeLessThanOrEqual(13)
    expect(z).toBeGreaterThanOrEqual(10)
  })

  it('одна точка — стандартный зум', () => {
    const url = mapEmbedUrl([a], null)!
    expect(url).toContain('z=16')
    expect(url).toContain('ll=20.4522,54.7104')
  })

  it('без координат карту не строим — остаётся схема', () => {
    expect(mapEmbedUrl([noCoords], noCoords)).toBeNull()
    expect(canEmbedMap([noCoords])).toBe(false)
    expect(canEmbedMap([noCoords, a])).toBe(true)
  })

  it('если выбранная точка без координат — центрируем на первой с координатами', () => {
    const url = mapEmbedUrl([a, noCoords], noCoords)!
    expect(url).toContain('ll=20.4522,54.7104')
    expect(url).toContain('pt=20.4522,54.7104')
  })
})
