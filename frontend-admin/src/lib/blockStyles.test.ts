import { describe, expect, it } from 'vitest'
import { newBlock, type BlockStyle, type MenuBlock, type MenuDoc } from './menuLayout'
import {
  applyStyle,
  bindBlocks,
  blockStyle,
  detachBlock,
  detachBlocks,
  mergeStylePatch,
  removeStyle,
  styleFromBlock,
  stylePropsOf,
  styleUsage,
  touchesStyle,
  updateStyle,
} from './blockStyles'

const block = (id: string, extra: Partial<MenuBlock> = {}): MenuBlock => ({ ...newBlock('text'), id, ...extra })

const style = (id: string, extra: Partial<BlockStyle> = {}): BlockStyle => ({
  id,
  name: id,
  fontSizePt: 18,
  bold: true,
  align: 'center',
  lineHeight: 1.3,
  tracking: 40,
  uppercase: true,
  ...extra,
})

const docWith = (blocks: MenuBlock[], styles: BlockStyle[] = []): MenuDoc => ({
  pages: [{ id: 'page-1', blocks }],
  ...(styles.length ? { styles } : {}),
})

describe('мастер-стили блоков', () => {
  it('стиль из блока берёт только текстовые свойства', () => {
    const b = block('t1', { fontSizePt: 24, bold: true, align: 'right', lineHeight: 1.4, tracking: 80, uppercase: true })
    const s = styleFromBlock('  Название  ', b)
    expect(s.name).toBe('Название')
    expect(stylePropsOf(b)).toEqual({
      fontSizePt: 24,
      bold: true,
      align: 'right',
      lineHeight: 1.4,
      tracking: 80,
      uppercase: true,
    })
    // Геометрия в стиль не попадает: иначе правка стиля двигала бы блоки.
    expect(s).not.toHaveProperty('wPct')
  })

  it('пустое имя не оставляет стиль безымянным', () => {
    expect(styleFromBlock('   ', block('t1')).name).toBe('Стиль')
  })

  it('привязка применяет значения стиля и запоминает id', () => {
    const s = style('style-1')
    const out = applyStyle(block('t1', { fontSizePt: 10, bold: false }), s)
    expect(out.fontSizePt).toBe(18)
    expect(out.bold).toBe(true)
    expect(out.styleId).toBe('style-1')
    // Геометрия и контент не тронуты.
    expect(out.xPct).toBe(0)
    expect(out.text).toBe(block('t1').text)
  })

  it('правка стиля меняет все привязанные блоки на всех страницах', () => {
    const doc: MenuDoc = {
      styles: [style('style-1')],
      pages: [
        { id: 'page-1', blocks: [block('a', { styleId: 'style-1' }), block('free')] },
        { id: 'page-2', blocks: [block('b', { styleId: 'style-1' })] },
      ],
    }
    const next = updateStyle(doc, 'style-1', { fontSizePt: 12 })
    expect(next.styles?.[0]?.fontSizePt).toBe(12)
    expect(next.pages[0]!.blocks[0]!.fontSizePt).toBe(12)
    expect(next.pages[1]!.blocks[0]!.fontSizePt).toBe(12)
    // Свободный блок живёт своей жизнью.
    expect(next.pages[0]!.blocks[1]!.fontSizePt).toBe(doc.pages[0]!.blocks[1]!.fontSizePt)
    expect(styleUsage(next, 'style-1')).toBe(2)
  })

  it('привязка выделения и отвязка', () => {
    const doc = docWith([block('a'), block('b')], [style('style-1', { fontSizePt: 30 })])
    const bound = bindBlocks(doc, ['a'], 'style-1')
    expect(bound.pages[0]!.blocks[0]!.styleId).toBe('style-1')
    expect(bound.pages[0]!.blocks[0]!.fontSizePt).toBe(30)
    expect(bound.pages[0]!.blocks[1]!.styleId).toBeUndefined()

    const detached = detachBlocks(bound, ['a'])
    expect(detached.pages[0]!.blocks[0]!.styleId).toBeNull()
    // Значения остаются как были — отвязка не должна «сбрасывать» вёрстку.
    expect(detached.pages[0]!.blocks[0]!.fontSizePt).toBe(30)
  })

  it('привязка к несуществующему стилю ничего не портит', () => {
    const doc = docWith([block('a')])
    expect(bindBlocks(doc, ['a'], 'нет-такого')).toBe(doc)
    expect(detachBlock(block('a')).styleId).toBeUndefined()
  })

  it('удаление стиля оставляет блокам их настройки', () => {
    const doc = docWith([block('a', { styleId: 'style-1', fontSizePt: 22 })], [style('style-1')])
    const next = removeStyle(doc, 'style-1')
    expect(next.styles).toEqual([])
    expect(next.pages[0]!.blocks[0]!.styleId).toBeNull()
    expect(next.pages[0]!.blocks[0]!.fontSizePt).toBe(22)
  })

  it('blockStyle не падает, если стиль удалён из документа руками', () => {
    const doc = docWith([block('a', { styleId: 'ghost' })])
    expect(blockStyle(doc, doc.pages[0]!.blocks[0]!)).toBeNull()
    expect(blockStyle(doc, null)).toBeNull()
  })

  it('из правки блока в стиль уходят только стилевые поля', () => {
    expect(touchesStyle({ fontSizePt: 12 })).toBe(true)
    expect(touchesStyle({ bold: true })).toBe(true)
    expect(touchesStyle({ xPct: 10, titleOverride: 'Капучино' })).toBe(false)
    expect(mergeStylePatch({ fontSizePt: 12, xPct: 10, hidden: true, uppercase: true })).toEqual({
      fontSizePt: 12,
      uppercase: true,
    })
  })
})
