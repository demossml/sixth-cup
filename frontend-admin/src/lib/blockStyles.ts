import type { BlockStyle, MenuBlock, MenuDoc } from './menuLayout'

/**
 * Мастер-стили блоков (P2-2).
 *
 * Стиль хранит только текстовые свойства: кегль, жирность, выравнивание,
 * интерлиньяж, трекинг и капс. Геометрия, контент и цвет остаются у блока —
 * иначе одна правка стиля двигала бы блоки по листу.
 *
 * Стили лежат в документе макета (`doc.styles`), а значения при привязке
 * раскладываются в сами блоки. Поэтому PDF не нужно ничего досчитывать: он
 * печатает ровно то, что видно на холсте.
 */

/** Поля блока, которыми управляет стиль. */
export const STYLE_PROPS = ['fontSizePt', 'bold', 'align', 'lineHeight', 'tracking', 'uppercase'] as const

export type StyleProps = Pick<BlockStyle, (typeof STYLE_PROPS)[number]>

/** Нормальные значения для стиля: интерлиньяж и трекинг могут быть не заданы. */
export function stylePropsOf(block: MenuBlock): StyleProps {
  return {
    fontSizePt: block.fontSizePt,
    bold: !!block.bold,
    align: block.align,
    lineHeight: block.lineHeight ?? 1.15,
    tracking: block.tracking ?? 0,
    uppercase: !!block.uppercase,
  }
}

/** Новый стиль по текущим настройкам блока. */
export function styleFromBlock(name: string, block: MenuBlock, id?: string): BlockStyle {
  const clean = name.trim().slice(0, 40)
  return {
    id: id ?? `style-${Math.random().toString(36).slice(2, 9)}`,
    name: clean || 'Стиль',
    ...stylePropsOf(block),
  }
}

/** Блок со свойствами стиля и ссылкой на него. */
export function applyStyle(block: MenuBlock, style: BlockStyle): MenuBlock {
  return { ...block, ...pick(style), styleId: style.id }
}

/** Отвязка: значения остаются как есть, блок больше не следует за стилем. */
export function detachBlock(block: MenuBlock): MenuBlock {
  return block.styleId ? { ...block, styleId: null } : block
}

/** Правка стиля: меняем сам стиль и раскладываем значения во все его блоки. */
export function updateStyle(doc: MenuDoc, styleId: string, patch: Partial<StyleProps> & { name?: string }): MenuDoc {
  const styles = (doc.styles ?? []).map((s) => (s.id === styleId ? { ...s, ...patch } : s))
  const next = styles.find((s) => s.id === styleId)
  if (!next) return doc
  return {
    ...doc,
    styles,
    pages: doc.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((b) => (b.styleId === styleId ? applyStyle(b, next) : b)),
    })),
  }
}

/** Привязать блоки к стилю: значения стиля применяются сразу. */
export function bindBlocks(doc: MenuDoc, blockIds: string[], styleId: string): MenuDoc {
  const style = (doc.styles ?? []).find((s) => s.id === styleId)
  if (!style) return doc
  const ids = new Set(blockIds)
  return {
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((b) => (ids.has(b.id) ? applyStyle(b, style) : b)),
    })),
  }
}

/** Отвязать блоки: значения остаются, привязка снимается. */
export function detachBlocks(doc: MenuDoc, blockIds: string[]): MenuDoc {
  const ids = new Set(blockIds)
  return {
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((b) => (ids.has(b.id) ? detachBlock(b) : b)),
    })),
  }
}

/** Удалить стиль: блоки остаются со своими значениями, но без привязки. */
export function removeStyle(doc: MenuDoc, styleId: string): MenuDoc {
  return {
    ...doc,
    styles: (doc.styles ?? []).filter((s) => s.id !== styleId),
    pages: doc.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((b) => (b.styleId === styleId ? { ...b, styleId: null } : b)),
    })),
  }
}

/** Сколько блоков во всём документе следует за стилем. */
export function styleUsage(doc: MenuDoc, styleId: string): number {
  let count = 0
  for (const page of doc.pages) {
    for (const block of page.blocks) if (block.styleId === styleId) count += 1
  }
  return count
}

/** Стиль блока, если он привязан и стиль ещё существует. */
export function blockStyle(doc: MenuDoc, block: MenuBlock | null | undefined): BlockStyle | null {
  if (!block?.styleId) return null
  return (doc.styles ?? []).find((s) => s.id === block.styleId) ?? null
}

/** Изменилось ли что-то из свойств стиля — чтобы не гонять документ вхолостую. */
export function touchesStyle(patch: Partial<MenuBlock>): boolean {
  return STYLE_PROPS.some((key) => key in patch)
}

/** Выбирает из правки блока только те поля, которые принадлежат стилю. */
export function mergeStylePatch(patch: Partial<MenuBlock>): Partial<StyleProps> {
  const out: Partial<StyleProps> = {}
  if (patch.fontSizePt !== undefined) out.fontSizePt = patch.fontSizePt
  if (patch.bold !== undefined) out.bold = patch.bold
  if (patch.align !== undefined) out.align = patch.align
  if (patch.lineHeight !== undefined) out.lineHeight = patch.lineHeight
  if (patch.tracking !== undefined) out.tracking = patch.tracking
  if (patch.uppercase !== undefined) out.uppercase = patch.uppercase
  return out
}

function pick(style: BlockStyle): StyleProps {
  return {
    fontSizePt: style.fontSizePt,
    bold: style.bold,
    align: style.align,
    lineHeight: style.lineHeight,
    tracking: style.tracking,
    uppercase: style.uppercase,
  }
}
