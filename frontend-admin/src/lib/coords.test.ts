import { describe, expect, it } from 'vitest'
import { fmtCoord, parseCoords } from './coords'

describe('parseCoords', () => {
  it('понимает строку «широта, долгота»', () => {
    expect(parseCoords('55.7558, 37.6173')).toEqual({ lat: 55.7558, lng: 37.6173 })
    expect(parseCoords('55.7558 37.6173')).toEqual({ lat: 55.7558, lng: 37.6173 })
  })

  it('Яндекс отдаёт долготу первой — разворачиваем', () => {
    expect(parseCoords('https://yandex.ru/maps/?pt=37.6173,55.7558&z=17')).toEqual({ lat: 55.7558, lng: 37.6173 })
    expect(parseCoords('https://yandex.ru/maps/?ll=37.6173%2C55.7558&z=17')).toEqual({ lat: 55.7558, lng: 37.6173 })
    expect(parseCoords('https://yandex.ru/maps/?text=55.7558,37.6173')).toEqual({ lat: 55.7558, lng: 37.6173 })
  })

  it('Google: /@lat,lng,z и !3d!4d и ?q=', () => {
    expect(parseCoords('https://www.google.com/maps/@55.7558,37.6173,17z')).toEqual({ lat: 55.7558, lng: 37.6173 })
    expect(parseCoords('https://www.google.com/maps/place/x/data=!4m2!3d55.7558!4d37.6173')).toEqual({ lat: 55.7558, lng: 37.6173 })
    expect(parseCoords('https://maps.google.com/?q=55.7558,37.6173')).toEqual({ lat: 55.7558, lng: 37.6173 })
  })

  it('Apple: ?ll= и ?daddr=', () => {
    expect(parseCoords('https://maps.apple.com/?ll=55.7558,37.6173&q=6.7')).toEqual({ lat: 55.7558, lng: 37.6173 })
    expect(parseCoords('https://maps.apple.com/?daddr=55.7558,37.6173')).toEqual({ lat: 55.7558, lng: 37.6173 })
  })

  it('разворачивает порядок, когда первое число не может быть широтой', () => {
    // 95.1 не бывает широтой — значит это долгота.
    expect(parseCoords('95.1, 55.7558')).toEqual({ lat: 55.7558, lng: 95.1 })
  })

  it('не выдумывает координаты из мусора', () => {
    expect(parseCoords('')).toBeNull()
    expect(parseCoords('ул. Ленина, 1')).toBeNull()
    expect(parseCoords('https://yandex.ru/maps/213/moscow/')).toBeNull()
    expect(parseCoords('0, 0')).toBeNull()
    expect(parseCoords('95.1, 200.4')).toBeNull()
  })
})

describe('fmtCoord', () => {
  it('убирает лишние нули, но сохраняет точность', () => {
    expect(fmtCoord(55.755826)).toBe('55.755826')
    expect(fmtCoord(37.6)).toBe('37.6')
    expect(fmtCoord(55.75)).toBe('55.75')
  })
})
