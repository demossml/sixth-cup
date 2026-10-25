import { describe, expect, it } from 'vitest'
import { mediaUrlError } from './PromoMediaField'

describe('media url validation', () => {
  it('accepts our own uploads and public http(s) links', () => {
    expect(mediaUrlError('', 'image')).toBe('')
    expect(mediaUrlError('/uploads/1712-hero.webp', 'image')).toBe('')
    expect(mediaUrlError('https://cdn.example.com/a.jpg', 'image')).toBe('')
    expect(mediaUrlError('http://example.com/v.mp4', 'video')).toBe('')
  })

  it('explains why a local path will not work instead of saving it', () => {
    expect(mediaUrlError('C:\\Images\\photo.jpg', 'image')).toContain('Windows')
    expect(mediaUrlError('/Users/name/Pictures/photo.jpg', 'image')).toContain('Путь на компьютере')
    expect(mediaUrlError('~/Desktop/a.png', 'image')).toContain('Путь на компьютере')
    expect(mediaUrlError('file:///Users/name/a.png', 'image')).toContain('путь к файлу на компьютере')
  })

  it('rejects nonsense with a hint about the allowed form', () => {
    expect(mediaUrlError('photo.jpg', 'image')).toContain('/uploads/')
    expect(mediaUrlError('photo.mp4', 'video')).toContain('MP4/WebM')
  })
})
