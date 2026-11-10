import { describe, expect, it } from 'vitest'
import {
  addItemToSection,
  docPayload,
  docSections,
  itemCount,
  moveItem,
  removeItem,
  renameSection,
  toggleItemHidden,
  type MenuDoc,
  type MenuSection,
} from './menuLayout'

const item = (id: string, hidden = false) => ({
  id,
  productId: Number(id.replace(/\D/g, '')) || 1,
  groupId: null,
  titleOverride: null,
  description: null,
  badge: null,
  showPhoto: true,
  photoUrlOverride: null,
  sizes: [],
  hidden,
})

const section = (id: string, items: ReturnType<typeof item>[]): MenuSection => ({
  id,
  title: 'Кофе',
  categoryId: 1,
  style: { showPhotos: true },
  items,
})

const doc = (sections: MenuSection[]): MenuDoc => ({
  schemaVersion: 2,
  pages: [{ id: 'page-1', blocks: [], sections }],
})

describe('секции «Места»', () => {
  it('docPayload сохраняет секции и версию схемы (иначе canvas-сохранение их стирает)', () => {
    const payload = docPayload(doc([section('s1', [item('i1')])]))
    expect(payload.schemaVersion).toBe(2)
    expect(payload.pages[0]!.sections?.[0]!.id).toBe('s1')
    expect(payload.pages[0]!.sections?.[0]!.items).toHaveLength(1)
  })

  it('перестановка позиций работает только внутри своей секции', () => {
    const d = doc([section('s1', [item('i1'), item('i2')]), section('s2', [item('i3')])])
    const moved = moveItem(d, 's1', 'i2', -1)
    expect(moved.pages[0]!.sections![0]!.items.map((x) => x.id)).toEqual(['i2', 'i1'])
    expect(moved.pages[0]!.sections![1]!.items.map((x) => x.id)).toEqual(['i3'])
    // крайние позиции не вылетают за границы
    expect(moveItem(d, 's1', 'i1', -1).pages[0]!.sections![0]!.items[0]!.id).toBe('i1')
  })

  it('скрытие, удаление и переименование', () => {
    const d = doc([section('s1', [item('i1')])])
    expect(toggleItemHidden(d, 's1', 'i1').pages[0]!.sections![0]!.items[0]!.hidden).toBe(true)
    expect(removeItem(d, 's1', 'i1').pages[0]!.sections![0]!.items).toHaveLength(0)
    expect(renameSection(d, 's1', '  Напитки ').pages[0]!.sections![0]!.title).toBe('Напитки')
    expect(renameSection(d, 's1', '   ').pages[0]!.sections![0]!.title).toBe('Кофе')
  })

  it('позиция из каталога приходит с объёмами, а не с пустым списком', () => {
    const d = doc([section('s1', [])])
    const next = addItemToSection(d, 's1', {
      id: 42,
      name: 'Капучино',
      price: 169,
      imageUrl: null,
      available: true,
      categoryId: 1,
      categoryName: 'Кофе',
      variantLabel: null,
      prices: [
        { label: '250 мл', priceRub: 169 },
        { label: '350 мл', priceRub: 219 },
      ],
    })
    const it = next.pages[0]!.sections![0]!.items[0]!
    expect(it.productId).toBe(42)
    expect(it.sizes.map((s) => s.label)).toEqual(['250 мл', '350 мл'])
    expect(it.hidden).toBe(false)
  })

  it('docSections и itemCount считают только видимые позиции', () => {
    const d = doc([section('s1', [item('i1'), item('i2', true)])])
    const list = docSections(d)
    expect(list).toHaveLength(1)
    expect(itemCount(list[0]!.section)).toBe(1)
  })
})
