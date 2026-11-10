/**
 * AI-помощник макета: модель предлагает операции, сервер их применяет.
 * Модель не пишет документ напрямую — это главное, что здесь проверяем.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-menu-ai-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { normalizeDoc } = await import('../modules/admin/menuLayoutDoc')
const { proposeByRules, applyOps } = await import('../modules/admin/menuLayoutAi')

const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }

const mkLayout = async (doc?: unknown) => {
  const created = await app.request('/api/admin/menu-layouts', { method: 'POST', headers: H, body: JSON.stringify({ title: 'AI' }) })
  const { layout } = (await created.json()) as { layout: { id: number } }
  if (doc) {
    await app.request(`/api/admin/menu-layouts/${layout.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ doc }) })
  }
  return layout.id
}

beforeEach(() => {
  db.prepare('DELETE FROM menu_layouts').run()
})

describe('AI: предложение и применение', () => {
  it('«добавь <категорию>» предлагает добавить только отсутствующие позиции', async () => {
    const cat = Number(
      db.prepare('INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,1,?,?)').run('Напитки', 0, Date.now(), Date.now()).lastInsertRowid,
    )
    const p1 = Number(db.prepare('INSERT INTO products(name, price, icon, available, category_id) VALUES(?,?,?,1,?)').run('Латте', 200, 'Coffee', cat).lastInsertRowid)
    db.prepare('INSERT INTO products(name, price, icon, available, category_id) VALUES(?,?,?,1,?)').run('Раф', 220, 'Coffee', cat)

    const doc = normalizeDoc({
      schemaVersion: 2,
      pages: [{ id: 'page-1', blocks: [], sections: [{ id: 's1', title: 'Напитки', categoryId: cat, items: [{ id: 'it1', productId: p1, sizes: [] }] }] }],
    })
    const plan = proposeByRules('добавь напитки', doc)
    expect(plan.ops).toHaveLength(1)
    const op = plan.ops[0]!
    expect(op.kind).toBe('add-items')
    if (op.kind === 'add-items') {
      expect(op.productIds).toHaveLength(1) // Латте уже есть
      expect(op.productIds).not.toContain(p1)
    }
  })

  it('«убери X» скрывает позицию, «переименуй A в B» меняет заголовок секции', () => {
    const doc = normalizeDoc({
      schemaVersion: 2,
      pages: [
        {
          id: 'page-1',
          blocks: [],
          sections: [{ id: 's1', title: 'Добавки', categoryId: 1, items: [{ id: 'i1', productId: 5, titleOverride: 'Корица', sizes: [] }] }],
        },
      ],
    })
    const hide = proposeByRules('убери корицу', doc)
    expect(hide.ops[0]).toMatchObject({ kind: 'hide-item', itemId: 'i1' })

    const rename = proposeByRules('переименуй добавки в топпинги', doc)
    expect(rename.ops[0]).toMatchObject({ kind: 'rename-section', title: 'топпинги' })

    const applied = applyOps(doc, hide.ops)
    expect(applied.changed).toBe(1)
    expect(applied.doc.pages[0]!.sections![0]!.items[0]!.hidden).toBe(true)
  })

  it('непонятный запрос не предлагает операций', () => {
    const doc = normalizeDoc({ pages: [{ id: 'p', blocks: [] }] })
    expect(proposeByRules('сделай красиво как в инстаграме', doc).ops).toEqual([])
  })

  it('POST /ai/propose → /ai/apply: лист реально меняется', async () => {
    const cat = Number(
      db.prepare('INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,1,?,?)').run('Кофе', 0, Date.now(), Date.now()).lastInsertRowid,
    )
    db.prepare('INSERT INTO products(name, price, icon, available, category_id) VALUES(?,?,?,1,?)').run('Капучино', 190, 'Coffee', cat)
    const id = await mkLayout()

    const proposed = await app.request(`/api/admin/menu-layouts/${id}/ai/propose`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: 'добавь кофе' }),
    })
    expect(proposed.status).toBe(200)
    const { plan } = (await proposed.json()) as { plan: { ops: unknown[]; summary: string } }
    expect(plan.ops.length).toBeGreaterThan(0)

    const applied = await app.request(`/api/admin/menu-layouts/${id}/ai/apply`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ ops: plan.ops }),
    })
    expect(applied.status).toBe(200)
    const body = (await applied.json()) as { changed: number; layout: { sections: number; stats: { products: number } } }
    expect(body.changed).toBeGreaterThan(0)
    expect(body.layout.sections).toBe(1)
    expect(body.layout.stats.products).toBe(1)
  })

  it('/ai/apply с устаревшим baseRev отвечает 409', async () => {
    const id = await mkLayout()
    const res = await app.request(`/api/admin/menu-layouts/${id}/ai/apply`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ ops: [{ kind: 'rename-section', sectionId: 'x', title: 'Y' }], baseRev: 0 }),
    })
    expect(res.status).toBe(409)
  })
})
