import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RECT,
  DEFAULT_THEME,
  bringToFront,
  byZ,
  clampRect,
  collapseDuplicateProducts,
  docPayload,
  driftBanner,
  duplicateProducts,
  effectiveType,
  formatFull,
  formatSize,
  formatRatio,
  localDrift,
  moveRect,
  newBlock,
  nextFreeRect,
  productBlock,
  resizeRect,
  resolvePreview,
  sendToBack,
  topZ,
  toggleHidden,
  usedProductIds,
  type MenuBlock,
} from './menuLayout'

const b = (type: MenuBlock['type'], id: string, extra: Partial<MenuBlock> = {}): MenuBlock =>
  newBlock(type as never, {}, { id, ...extra })

describe('геометрия холста', () => {
  it('clampRect не выпускает блок за лист и не даёт нулевой размер', () => {
    expect(clampRect({ xPct: -10, yPct: -5, wPct: 40, hPct: 10 })).toEqual({ xPct: 0, yPct: 0, wPct: 40, hPct: 10 })
    expect(clampRect({ xPct: 95, yPct: 98, wPct: 40, hPct: 10 })).toEqual({ xPct: 60, yPct: 90, wPct: 40, hPct: 10 })
    const tiny = clampRect({ xPct: 10, yPct: 10, wPct: 0, hPct: 0 })
    expect(tiny.wPct).toBeGreaterThanOrEqual(6)
    expect(tiny.hPct).toBeGreaterThanOrEqual(2)
  })

  it('moveRect двигает блок и держит в границах листа', () => {
    const r = { xPct: 10, yPct: 10, wPct: 20, hPct: 10 }
    expect(moveRect(r, 5, 5)).toEqual({ xPct: 15, yPct: 15, wPct: 20, hPct: 10 })
    expect(moveRect(r, -100, -100)).toEqual({ xPct: 0, yPct: 0, wPct: 20, hPct: 10 })
    expect(moveRect(r, 100, 100)).toEqual({ xPct: 80, yPct: 90, wPct: 20, hPct: 10 })
  })

  it('resizeRect меняет размер от угла, не сдвигая блок', () => {
    const r = { xPct: 10, yPct: 10, wPct: 20, hPct: 10 }
    expect(resizeRect(r, 'se', 5, 5)).toEqual({ xPct: 10, yPct: 10, wPct: 25, hPct: 15 })
    expect(resizeRect(r, 'e', 5, 5).hPct).toBe(10)
    expect(resizeRect(r, 's', 5, 5).wPct).toBe(20)
    expect(resizeRect({ xPct: 80, yPct: 80, wPct: 15, hPct: 15 }, 'se', 50, 50)).toEqual({ xPct: 80, yPct: 80, wPct: 20, hPct: 20 })
  })
})

describe('слои и видимость', () => {
  const blocks = [b('text', 'a', { zIndex: 1 }), b('text', 'z', { zIndex: 5 })]

  it('topZ выше всех, bringToFront поднимает выбранный', () => {
    expect(topZ(blocks)).toBe(6)
    const front = bringToFront(blocks, 'a')
    expect(front.find((x) => x.id === 'a')!.zIndex).toBe(6)
    expect(byZ(front).map((x) => x.id)).toEqual(['a', 'z'])
  })

  it('sendToBack опускает под остальные', () => {
    const back = sendToBack(blocks, 'z')
    expect(byZ(back).map((x) => x.id)).toEqual(['a', 'z'])
    expect(back.find((x) => x.id === 'z')!.zIndex).toBeLessThan(1)
  })

  it('toggleHidden скрывает, но не удаляет', () => {
    const hidden = toggleHidden(blocks, 'a')
    expect(hidden).toHaveLength(2)
    expect(hidden.find((x) => x.id === 'a')!.hidden).toBe(true)
  })
})

describe('новые блоки встают в свободное место', () => {
  it('не пересекаются с уже стоящими', () => {
    const first = nextFreeRect([], 40, 8)
    const blocks = [b('product', 'p1', first)]
    const second = nextFreeRect(blocks, 40, 8)
    const overlap =
      second.xPct < first.xPct + first.wPct &&
      second.xPct + second.wPct > first.xPct &&
      second.yPct < first.yPct + first.hPct &&
      second.yPct + second.hPct > first.yPct
    expect(overlap).toBe(false)
  })

  it('productBlock запоминает снапшот и ставится в переданную рамку', () => {
    const pb = productBlock(
      {
        id: 7,
        name: 'Латте',
        price: 189,
        imageUrl: '/uploads/latte.jpg',
        available: true,
        categoryId: 3,
        categoryName: 'Кофе',
        variantLabel: '400 мл',
      },
      { xPct: 12, yPct: 34, wPct: 40, hPct: 7 },
      3,
    )
    expect(pb.productId).toBe(7)
    expect(pb.snapshotPriceRub).toBe(189)
    expect(pb.xPct).toBe(12)
    expect(pb.yPct).toBe(34)
    expect(pb.zIndex).toBe(3)
  })

  it('дефолтные размеры по типу разумные', () => {
    expect(DEFAULT_RECT.product.h).toBeGreaterThan(4)
    expect(DEFAULT_RECT.image.w).toBeGreaterThan(10)
  })
})

describe('payload и legacy-типы', () => {
  it('в payload нет серверных полей резолва', () => {
    const block = { ...b('product', 'p', { productId: 1 }), displayName: 'Капучино', warnings: ['нет фото'], product: null }
    const payload = docPayload({ pages: [{ id: 'p', blocks: [block] }] })
    expect(payload.pages[0]!.blocks[0]).not.toHaveProperty('displayName')
    expect(payload.pages[0]!.blocks[0]).not.toHaveProperty('warnings')
    expect(payload.pages[0]!.blocks[0]!.xPct).toBeTypeOf('number')
  })

  it('старые типы приводятся к холсту', () => {
    expect(effectiveType({ type: 'photo' } as MenuBlock)).toBe('image')
    expect(effectiveType({ type: 'header' } as MenuBlock)).toBe('text')
    expect(effectiveType({ type: 'product' } as MenuBlock)).toBe('product')
  })
})

describe('локальный резолв каталога', () => {
  const catalog = [
    {
      id: 1,
      name: 'Капучино',
      price: 169,
      imageUrl: '/uploads/capp.jpg',
      available: true,
      categoryId: 10,
      categoryName: 'Кофе',
      variantLabel: '200 / 400 мл',
    },
  ]

  it('live берёт цену каталога, frozen — снапшот', () => {
    const doc = {
      pages: [
        {
          id: 'p',
          blocks: [b('category', 'c', { categoryId: 10 }), b('product', 'p1', { productId: 1, snapshotPriceRub: 159 })],
        },
      ],
    }
    const live = resolvePreview(doc, catalog, 'live').pages[0]!.blocks
    expect(live[0]!.displayCategory).toBe('Кофе')
    expect(live[1]!.displayPrice).toBe('169')
    expect(live[1]!.product?.variantLabel).toBe('200 / 400 мл')

    const frozen = resolvePreview(doc, catalog, 'frozen').pages[0]!.blocks
    expect(frozen[1]!.displayPrice).toBe('159')
  })

  it('своё фото сильнее каталога', () => {
    const doc = {
      pages: [{ id: 'p', blocks: [b('product', 'p1', { productId: 1, photoUrlOverride: '/uploads/mine.jpg', showPhoto: true })] }],
    }
    const block = resolvePreview(doc, catalog, 'live').pages[0]!.blocks[0]!
    expect(block.displayImageUrl).toBe('/uploads/mine.jpg')
    expect(block.warnings).toEqual([])
  })

  it('удалённый товар, отсутствие цены и пустая картинка дают замечания', () => {
    const realDoc = {
      pages: [{ id: 'p', blocks: [b('product', 'ghost', { productId: 999 }), b('image', 'img', { url: null })] }],
    }
    const blocks = resolvePreview(realDoc, catalog, 'live').pages[0]!.blocks
    expect(blocks[0]!.warnings).toContain('позиции больше нет в каталоге')
    expect(blocks[0]!.warnings).toContain('нет цены')
    expect(blocks[1]!.warnings).toContain('нет картинки')
  })

  it('текст мельче 7 pt замечается у текстовых блоков и категорий, а не только у товаров', () => {
    const doc = {
      pages: [
        {
          id: 'p',
          blocks: [
            b('text', 't-small', { text: 'Сноска', fontSizePt: 5 }),
            b('text', 't-ok', { text: 'Обычный текст', fontSizePt: 12 }),
            b('category', 'cat-small', { titleOverride: 'Кофе', fontSizePt: 6 }),
          ],
        },
      ],
    }
    const blocks = resolvePreview(doc, catalog, 'live').pages[0]!.blocks
    expect(blocks[0]!.warnings).toContain('текст мельче 7 pt')
    expect(blocks[1]!.warnings).not.toContain('текст мельче 7 pt')
    expect(blocks[2]!.warnings).toContain('текст мельче 7 pt')
  })

  it('localDrift показывает расхождение со снапшотом', () => {
    const doc = { pages: [{ id: 'p', blocks: [b('product', 'p1', { productId: 1, snapshotPriceRub: 159 })] }] }
    expect(localDrift(doc, catalog)).toEqual([{ blockId: 'p1', title: 'Капучино', from: 159, to: 169 }])
  })
})

describe('один productId = один блок', () => {
  const p = (id: string, productId: number, extra: Partial<MenuBlock> = {}) =>
    b('product', id, { productId, sortOrder: 0, ...extra })

  it('usedProductIds собирает позиции со всех страниц и игнорирует скрытые', () => {
    const doc = {
      pages: [
        { id: 'p1', blocks: [p('a', 10), p('h', 20, { hidden: true })] },
        { id: 'p2', blocks: [p('c', 30), b('text', 't')] },
      ],
    }
    expect(usedProductIds(doc).sort()).toEqual([10, 30])
  })

  it('duplicateProducts находит только реальные дубли', () => {
    const doc = {
      pages: [
        { id: 'p1', blocks: [p('a', 10), p('b', 10)] },
        { id: 'p2', blocks: [p('c', 10), p('d', 30)] },
      ],
    }
    expect(duplicateProducts(doc)).toEqual([{ productId: 10, blockIds: ['a', 'b', 'c'] }])
  })

  it('collapseDuplicateProducts оставляет первый по sortOrder и не трогает остальные типы', () => {
    const doc = {
      pages: [
        { id: 'p1', blocks: [p('a', 10, { sortOrder: 2 }), b('text', 't'), p('b', 10, { sortOrder: 1 })] },
        { id: 'p2', blocks: [p('c', 10, { sortOrder: 0 })] },
      ],
    }
    const next = collapseDuplicateProducts(doc)
    const ids = next.pages.flatMap((pg) => pg.blocks.map((x) => x.id))
    expect(ids).toEqual(['t', 'b'])
    expect(duplicateProducts(next)).toEqual([])
  })
})

describe('подписи форматов', () => {
  it('миллиметры только у бумаги, экран — пропорция', () => {
    expect(formatSize('a4_portrait')).toBe('210 × 297 мм')
    expect(formatSize('screen_16_9')).toBe('16:9')
    expect(formatSize('screen_16_9')).not.toContain('мм')
    expect(formatFull('a4_portrait')).toBe('A4 · 210 × 297 мм')
    expect(formatFull('screen_16_9')).toBe('Экран · 16:9')
  })
})

describe('объёмы позиции', () => {
  const withSizes = [
    {
      id: 1,
      name: 'Капучино',
      price: 169,
      imageUrl: null,
      available: true,
      categoryId: 10,
      categoryName: 'Кофе',
      variantLabel: null,
      prices: [
        { label: '250 мл', priceRub: 169 },
        { label: '350 мл', priceRub: 219 },
        { label: '450 мл', priceRub: 269 },
      ],
    },
  ]

  it('три объёма печатаются строкой, а не тремя блоками', () => {
    const doc = { pages: [{ id: 'p', blocks: [b('product', 'p1', { productId: 1 })] }] }
    const block = resolvePreview(doc, doc_sizes(), 'live').pages[0]!.blocks[0]!
    expect(block.displaySizes).toEqual([
      { label: '250 мл', price: '169' },
      { label: '350 мл', price: '219' },
      { label: '450 мл', price: '269' },
    ])
  })

  it('ручная цена сильнее объёмов', () => {
    const doc = { pages: [{ id: 'p', blocks: [b('product', 'p1', { productId: 1, priceRubOverride: 199 })] }] }
    expect(resolvePreview(doc, doc_sizes(), 'live').pages[0]!.blocks[0]!.displaySizes).toEqual([])
  })

  it('frozen берёт снимок объёмов', () => {
    const doc = {
      pages: [
        {
          id: 'p',
          blocks: [
            b('product', 'p1', {
              productId: 1,
              snapshotSizes: [
                { label: '250 мл', price: '160' },
                { label: '350 мл', price: '210' },
              ],
            }),
          ],
        },
      ],
    }
    expect(resolvePreview(doc, doc_sizes(), 'frozen').pages[0]!.blocks[0]!.displaySizes).toEqual([
      { label: '250 мл', price: '160' },
      { label: '350 мл', price: '210' },
    ])
  })

  const doc_sizes = () => withSizes
})

describe('служебное', () => {
  it('баннер цен различает live и frozen', () => {
    const drift = [{ title: 'Капучино', from: 169, to: 179 }]
    expect(driftBanner(drift, 'live')).toContain('169 → 179 ₽')
    expect(driftBanner(drift, 'frozen')).toContain('зафиксированы')
    expect(driftBanner([], 'live')).toBeNull()
  })

  it('форматы и тема по умолчанию', () => {
    expect(formatRatio('a4_portrait')).toBeLessThan(1)
    expect(formatRatio('screen_16_9')).toBeGreaterThan(1)
    expect(DEFAULT_THEME.bg).toBe('#F6F3EE')
    expect(DEFAULT_THEME.backgroundImageUrl).toBeNull()
  })
})
