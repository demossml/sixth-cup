import { describe, expect, it } from 'vitest'
import { newBlock, type LayoutComment, type MenuDoc } from './menuLayout'
import {
  MAX_COMMENT_LENGTH,
  addComment,
  commentPrintLine,
  commentsForBlock,
  createComment,
  dropOrphans,
  openCommentCounts,
  openComments,
  orphanComments,
  removeComment,
  setResolved,
  updateCommentText,
} from './blockComments'

const docWith = (blocks: string[], comments: LayoutComment[] = []): MenuDoc => ({
  pages: [{ id: 'p1', blocks: blocks.map((id) => ({ ...newBlock('text'), id })) }],
  ...(comments.length ? { comments } : {}),
})

const note = (id: string, blockId: string, extra: Partial<LayoutComment> = {}): LayoutComment => ({
  id,
  blockId,
  text: `текст ${id}`,
  author: null,
  createdAt: 1000,
  resolved: false,
  ...extra,
})

describe('замечания к блокам', () => {
  it('пустой текст не создаёт замечание, длинный — обрезается', () => {
    expect(createComment('b1', '   ')).toBeNull()
    const long = createComment('b1', 'я'.repeat(MAX_COMMENT_LENGTH + 50), { now: 1, id: 'n1' })
    expect(long?.text).toHaveLength(MAX_COMMENT_LENGTH)
    expect(long?.resolved).toBe(false)
  })

  it('автор обрезается, пробелы не остаются', () => {
    const c = createComment('b1', '  поправить цену  ', { author: '  типография ', now: 5, id: 'n1' })
    expect(c?.text).toBe('поправить цену')
    expect(c?.author).toBe('типография')
  })

  it('добавление и удаление', () => {
    const doc = docWith(['b1'])
    const added = addComment(doc, createComment('b1', 'проверить цену', { now: 10, id: 'n1' }))
    expect(added.comments).toHaveLength(1)
    const removed = removeComment(added, 'n1')
    expect(removed.comments).toEqual([])
    // Пустое замечание документ не меняет.
    expect(addComment(doc, null)).toBe(doc)
  })

  it('решённые уходят вниз, свежие открытые — сверху', () => {
    const doc = docWith(
      ['b1', 'b2'],
      [
        note('old', 'b1', { createdAt: 100 }),
        note('new', 'b1', { createdAt: 300 }),
        note('done', 'b1', { createdAt: 400, resolved: true }),
        note('other', 'b2', { createdAt: 200 }),
      ],
    )
    expect(commentsForBlock(doc, 'b1').map((c) => c.id)).toEqual(['new', 'old', 'done'])
    expect(commentsForBlock(doc, null)).toEqual([])
  })

  it('решённое замечание не считается открытым, но остаётся в документе', () => {
    const doc = docWith(['b1'], [note('a', 'b1'), note('b', 'b1')])
    const next = setResolved(doc, 'a', true)
    expect(openComments(next).map((c) => c.id)).toEqual(['b'])
    expect(openCommentCounts(next)).toEqual({ b1: 1 })
    expect(next.comments).toHaveLength(2)
    // Вернуть в работу тоже можно.
    expect(openCommentCounts(setResolved(next, 'a', false))).toEqual({ b1: 2 })
  })

  it('счётчики по блокам и общий список', () => {
    const doc = docWith(['b1', 'b2'], [note('a', 'b1'), note('b', 'b1'), note('c', 'b2', { resolved: true })])
    expect(openCommentCounts(doc)).toEqual({ b1: 2 })
    expect(openComments(doc).map((c) => c.id).sort()).toEqual(['a', 'b'])
  })

  it('правка текста: пустой не сохраняется', () => {
    const doc = docWith(['b1'], [note('a', 'b1')])
    expect(updateCommentText(doc, 'a', '  новое  ').comments?.[0]?.text).toBe('новое')
    expect(updateCommentText(doc, 'a', '   ')).toBe(doc)
  })

  it('замечания удалённых блоков чистятся, остальные остаются', () => {
    const doc = docWith(['b1'], [note('a', 'b1'), note('b', 'b2')])
    expect(orphanComments(doc).map((c) => c.id)).toEqual(['b'])
    const cleaned = dropOrphans(doc)
    expect(cleaned.comments?.map((c) => c.id)).toEqual(['a'])
    // Если чистить нечего — документ не пересоздаётся (важно для undo).
    expect(dropOrphans(cleaned)).toBe(cleaned)
  })

  it('строка для печати: номер, имя блока, автор', () => {
    const doc = docWith(['b1'], [note('a', 'b1', { text: 'цена не та', author: 'Аня' })])
    const block = doc.pages[0]!.blocks[0]!
    expect(commentPrintLine(doc.comments![0]!, block, 1)).toContain('1.')
    expect(commentPrintLine(doc.comments![0]!, block, 1)).toContain('Аня: цена не та')
    expect(commentPrintLine(doc.comments![0]!, null, 2)).toContain('2.')
  })
})
