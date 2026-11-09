import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  localDrift,
  resolvePreview,
  docSnapshot,
  driftBanner,
  flowPage,
  formatRatio,
  moveBlock,
  newBlock,
  productBlock,
  reindex,
  toggleHidden,
  type MenuBlock,
} from './menuLayout'

const b = (type: MenuBlock['type'], id: string, extra: Partial<MenuBlock> = {}): MenuBlock =>
  newBlock(type, 0, { id, ...extra })

describe('раскладка листа', () => {
  it('до первой категории — шапка, после последней — подвал', () => {
    const blocks = [
      b('header', 'h'),
      b('hero', 'hero'),
      b('category', 'c1'),
      b('product', 'p1'),
      b('product', 'p2'),
      b('note', 'n'),
    ]
    const flow = flowPage(blocks, 2)
    expect(flow.lead.map((x) => x.id)).toEqual(['h', 'hero'])
    expect(flow.tail.map((x) => x.id)).toEqual(['n'])
    expect(flow.columns[0]![0]!.category!.id).toBe('c1')
    expect(flow.columns[0]![0]!.products.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('позиции без категории не теряются', () => {
    const flow = flowPage([b('product', 'p1'), b('product', 'p2')], 2)
    const total = flow.columns.reduce((n, col) => n + col.reduce((m, g) => m + g.products.length, 0), 0)
    expect(total).toBe(2)
  })

  it('одна категория не рвётся на колонки, несколько — расходятся', () => {
    expect(flowPage([], 3).columns).toHaveLength(1)
    const single = [b('category', 'c1'), ...Array.from({ length: 9 }, (_, i) => b('product', `p${i}`))]
    expect(flowPage(single, 3).columns).toHaveLength(1)

    const three = [
      b('category', 'c1'), ...Array.from({ length: 4 }, (_, i) => b('product', `a${i}`)),
      b('category', 'c2'), ...Array.from({ length: 4 }, (_, i) => b('product', `b${i}`)),
      b('category', 'c3'), ...Array.from({ length: 4 }, (_, i) => b('product', `c${i}`)),
    ]
    const flow = flowPage(three, 3)
    expect(flow.columns).toHaveLength(3)
    expect(flow.columns.map((col) => col[0]!.category!.id)).toEqual(['c1', 'c2', 'c3'])
  })
})

describe('операции с блоками', () => {
  const blocks = [b('category', 'c'), b('product', 'p1'), b('product', 'p2')]

  it('moveBlock меняет порядок и перенумеровывает', () => {
    const moved = moveBlock(blocks, 'p2', -1)
    expect(moved.map((x) => x.id)).toEqual(['c', 'p2', 'p1'])
    expect(moved.map((x) => x.sortOrder)).toEqual([0, 1, 2])
    expect(moveBlock(blocks, 'c', -1).map((x) => x.id)).toEqual(['c', 'p1', 'p2'])
  })

  it('reindex чинит дырки в sortOrder', () => {
    const broken = blocks.map((x, i) => ({ ...x, sortOrder: i * 10 }))
    expect(reindex(broken).map((x) => x.sortOrder)).toEqual([0, 1, 2])
  })

  it('toggleHidden скрывает, но не удаляет', () => {
    const hidden = toggleHidden(blocks, 'p1')
    expect(hidden).toHaveLength(3)
    expect(hidden.find((x) => x.id === 'p1')!.hidden).toBe(true)
  })

  it('productBlock запоминает снапшот цены и фото', () => {
    const pb = productBlock(
      { id: 7, name: 'Латте', price: 189, imageUrl: '/uploads/latte.jpg', available: true, categoryId: 3, categoryName: 'Кофе', variantLabel: '400 мл' },
      0,
    )
    expect(pb.productId).toBe(7)
    expect(pb.snapshotPriceRub).toBe(189)
    expect(pb.snapshotImageUrl).toBe('/uploads/latte.jpg')
    expect(pb.categoryId).toBe(3)
  })
})

describe('баннер цен', () => {
  it('live и frozen говорят разное', () => {
    const drift = [{ title: 'Капучино', from: 169, to: 179 }]
    expect(driftBanner(drift, 'live')).toContain('Капучино 169 → 179 ₽')
    expect(driftBanner(drift, 'live')).toContain('обновите')
    expect(driftBanner(drift, 'frozen')).toContain('зафиксированы')
    expect(driftBanner([], 'live')).toBeNull()
  })

  it('больше двух расхождений сворачиваются в «и ещё N»', () => {
    const drift = Array.from({ length: 4 }, (_, i) => ({ title: `Поз ${i}`, from: 100, to: 110 }))
    expect(driftBanner(drift, 'live')).toContain('и ещё 2')
  })
})

describe('локальный резолв для превью', () => {
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
          blocks: [
            { ...newBlock('category', 0, { id: 'c', categoryId: 10 }), productId: null },
            newBlock('product', 1, { id: 'p1', productId: 1, snapshotPriceRub: 159 }),
          ],
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

  it('override и текст цены сильнее каталога', () => {
    const doc = {
      pages: [{ id: 'p', blocks: [newBlock('product', 0, { id: 'p1', productId: 1, titleOverride: 'Капучино 6.7', priceText: '169 / 269' })] }],
    }
    const b = resolvePreview(doc, catalog, 'live').pages[0]!.blocks[0]!
    expect(b.displayName).toBe('Капучино 6.7')
    expect(b.displayPrice).toBe('169 / 269')
    expect(b.warnings).toEqual([])
  })

  it('удалённый товар и отсутствие цены дают замечания', () => {
    const doc = { pages: [{ id: 'p', blocks: [newBlock('product', 0, { id: 'ghost', productId: 999 })] }] }
    const b = resolvePreview(doc, catalog, 'live').pages[0]!.blocks[0]!
    expect(b.warnings).toContain('позиции больше нет в каталоге')
    expect(b.warnings).toContain('нет цены')
  })

  it('localDrift показывает расхождение со снапшотом', () => {
    const doc = { pages: [{ id: 'p', blocks: [newBlock('product', 0, { id: 'p1', productId: 1, snapshotPriceRub: 159 })] }] }
    expect(localDrift(doc, catalog)).toEqual([{ blockId: 'p1', title: 'Капучино', from: 159, to: 169 }])
    const overridden = { pages: [{ id: 'p', blocks: [newBlock('product', 0, { id: 'p1', productId: 1, snapshotPriceRub: 159, priceRubOverride: 199 })] }] }
    expect(localDrift(overridden, catalog)).toEqual([])
  })
})

describe('служебное', () => {
  it('snapshot документа не тащит серверные поля', () => {
    const doc = { pages: [{ id: 'p', blocks: [{ ...b('product', 'p1'), displayName: 'Капучино', warnings: ['нет фото'] }] }] }
    const snap = docSnapshot(doc)
    expect(snap.pages[0]!.blocks[0]).not.toHaveProperty('displayName')
    expect(snap.pages[0]!.blocks[0]).not.toHaveProperty('warnings')
  })

  it('форматы: A4 портрет вертикальный, экран горизонтальный', () => {
    expect(formatRatio('a4_portrait')).toBeLessThan(1)
    expect(formatRatio('screen_16_9')).toBeGreaterThan(1)
    expect(formatRatio('unknown')).toBe(formatRatio('a4_portrait'))
  })

  it('тема по умолчанию — brand-safe классика', () => {
    expect(DEFAULT_THEME.bg).toBe('#F6F3EE')
    expect(DEFAULT_THEME.columns).toBe(2)
  })
})
