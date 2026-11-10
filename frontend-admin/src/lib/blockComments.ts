import type { LayoutComment, MenuBlock, MenuDoc } from './menuLayout'

/**
 * Замечания к блокам (P2-4).
 *
 * Раньше правки от типографии и дизайнера жили в переписке: «на второй странице
 * у «Корицы» съехала цена». Теперь замечание висит на блоке, видно в списке и
 * уезжает в PDF аннотацией-стикером, так что печатник видит его прямо на листе.
 *
 * Хранятся в документе макета (`doc.comments`), поэтому переживают сохранение,
 * черновик, undo и версии вместе с блоками.
 */

export const MAX_COMMENT_LENGTH = 500
export const MAX_AUTHOR_LENGTH = 40

let seq = 0

/** Новое замечание: обрезаем пробелы и ограничиваем длину, пустое не создаём. */
export function createComment(
  blockId: string,
  text: string,
  opts: { author?: string | null; now?: number; id?: string } = {},
): LayoutComment | null {
  const clean = text.trim().slice(0, MAX_COMMENT_LENGTH)
  if (!blockId || !clean) return null
  const author = (opts.author ?? '').trim().slice(0, MAX_AUTHOR_LENGTH) || null
  const now = opts.now ?? Date.now()
  return {
    id: opts.id ?? `note-${++seq}-${now.toString(36)}`,
    blockId,
    text: clean,
    author,
    createdAt: now,
    resolved: false,
  }
}

/** Добавить замечание в документ. */
export function addComment(doc: MenuDoc, comment: LayoutComment | null): MenuDoc {
  if (!comment) return doc
  return { ...doc, comments: [...(doc.comments ?? []), comment] }
}

/** Отметить замечание решённым или вернуть в работу. */
export function setResolved(doc: MenuDoc, commentId: string, resolved: boolean): MenuDoc {
  return {
    ...doc,
    comments: (doc.comments ?? []).map((c) => (c.id === commentId ? { ...c, resolved } : c)),
  }
}

/** Правка текста замечания: пустой текст не сохраняем. */
export function updateCommentText(doc: MenuDoc, commentId: string, text: string): MenuDoc {
  const clean = text.trim().slice(0, MAX_COMMENT_LENGTH)
  if (!clean) return doc
  return {
    ...doc,
    comments: (doc.comments ?? []).map((c) => (c.id === commentId ? { ...c, text: clean } : c)),
  }
}

export function removeComment(doc: MenuDoc, commentId: string): MenuDoc {
  return { ...doc, comments: (doc.comments ?? []).filter((c) => c.id !== commentId) }
}

/** Замечания блока: открытые сверху, внутри — свежие первыми. */
export function commentsForBlock(doc: MenuDoc, blockId: string | null | undefined): LayoutComment[] {
  if (!blockId) return []
  return (doc.comments ?? [])
    .filter((c) => c.blockId === blockId)
    .sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.createdAt - a.createdAt)
}

/** Сколько замечаний у каждого блока: нужно для точек на холсте и счётчиков в слоях. */
export function openCommentCounts(doc: MenuDoc): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of doc.comments ?? []) {
    if (c.resolved) continue
    out[c.blockId] = (out[c.blockId] ?? 0) + 1
  }
  return out
}

/** Все открытые замечания: для панели «Замечания» и экспорта в PDF. */
export function openComments(doc: MenuDoc): LayoutComment[] {
  return (doc.comments ?? []).filter((c) => !c.resolved).sort((a, b) => b.createdAt - a.createdAt)
}

/** Замечания, чьи блоки уже удалены: показывать их негде, поэтому чистим. */
export function orphanComments(doc: MenuDoc): LayoutComment[] {
  const ids = new Set(doc.pages.flatMap((p) => p.blocks.map((b) => b.id)))
  return (doc.comments ?? []).filter((c) => !ids.has(c.blockId))
}

export function dropOrphans(doc: MenuDoc): MenuDoc {
  const ids = new Set(doc.pages.flatMap((p) => p.blocks.map((b) => b.id)))
  const kept = (doc.comments ?? []).filter((c) => ids.has(c.blockId))
  if (kept.length === (doc.comments ?? []).length) return doc
  return { ...doc, comments: kept }
}

/** Номер и текст для печати: «1. Корица — цена не совпадает с каталогом». */
export function commentPrintLine(comment: LayoutComment, block: MenuBlock | null, index: number): string {
  const label = block?.displayName ?? block?.titleOverride ?? block?.text ?? block?.type ?? 'блок'
  const author = comment.author ? `${comment.author}: ` : ''
  return `${index}. ${label} — ${author}${comment.text}`
}
