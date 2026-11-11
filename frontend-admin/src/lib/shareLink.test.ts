import { describe, expect, it } from 'vitest'
import { shareUrl } from '../components/menuLayout/ShareDrawer'

describe('P2-5: ссылка на просмотр макета', () => {
  it('собирает абсолютный адрес из хэш-пути', () => {
    expect(shareUrl('#/share/abc123', 'http://localhost:5174')).toBe('http://localhost:5174/#/share/abc123')
    expect(shareUrl('/#/share/abc123', 'https://admin.sixth.cup')).toBe('https://admin.sixth.cup/#/share/abc123')
  })

  it('не удваивает слэш и убирает хвостовой слэш у origin', () => {
    expect(shareUrl('/share/abc', 'https://admin.sixth.cup/')).toBe('https://admin.sixth.cup/share/abc')
    expect(shareUrl('share/abc', 'https://admin.sixth.cup')).toBe('https://admin.sixth.cup/share/abc')
  })
})
