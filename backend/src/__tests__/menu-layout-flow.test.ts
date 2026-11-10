import { describe, expect, it } from 'vitest'
import { flowSections, relayoutDoc } from '../modules/admin/menuLayoutFlow'
import { normalizeDoc, type MenuBlock, type MenuSection } from '../modules/admin/menuLayoutDoc'

const item = (id: string, sizes = 1) => ({
  id,
  productId: 100,
  groupId: null,
  titleOverride: null,
  description: null,
  badge: null,
  showPhoto: false,
  photoUrlOverride: null,
  hidden: false,
  sizes: Array.from({ length: sizes }, (_, i) => ({
    label: `${250 + i * 100} мл`,
    source: 'catalog' as const,
    productId: 100,
    volumeItemId: i + 1,
    priceRubOverride: null,
  })),
})

const section = (id: string, title: string, count: number, sizes = 1): MenuSection => ({
  id,
  title,
  categoryId: 7,
  style: { showPhotos: false },
  items: Array.from({ length: count }, (_, i) => item(`${id}-${i}`, sizes)),
})

describe('раскладка секций', () => {
  it('одна секция: заголовок выше позиций, ничего не выходит за лист', () => {
    const { pages } = flowSections({ sections: [section('coffee', 'Кофе', 6)] })
    expect(pages).toHaveLength(1)
    const blocks = pages[0]!.blocks
    expect(blocks[0]!.type).toBe('category')
    expect(blocks.filter((b) => b.type === 'product')).toHaveLength(6)
    for (const b of blocks) {
      expect(b.xPct + b.wPct).toBeLessThanOrEqual(100.001)
      expect(b.yPct + b.hPct).toBeLessThanOrEqual(100.001)
    }
    // позиции не перекрываются по вертикали внутри колонки
    const col0 = blocks.filter((b) => b.type === 'product' && b.xPct === 0).sort((a, b) => a.yPct - b.yPct)
    for (let i = 1; i < col0.length; i++) expect(col0[i]!.yPct).toBeGreaterThanOrEqual(col0[i - 1]!.yPct + col0[i - 1]!.hPct)
  })

  it('много позиций переносится на следующую страницу, а не уезжает за край', () => {
    const { pages, dropped } = flowSections({ sections: [section('big', 'Всё меню', 120)] })
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.length).toBeLessThanOrEqual(12)
    expect(dropped).toBe(0)
    const all = pages.flatMap((p) => p.blocks).filter((b) => b.type === 'product')
    expect(all).toHaveLength(120)
    for (const b of all) expect(b.yPct + b.hPct).toBeLessThanOrEqual(100.001)
  })

  it('позиция с объёмами занимает больше места', () => {
    const plain = flowSections({ sections: [section('a', 'Кофе', 3, 1)] }).pages[0]!.blocks
    const withSizes = flowSections({ sections: [section('a', 'Кофе', 3, 3)] }).pages[0]!.blocks
    const h = (blocks: MenuBlock[]) => blocks.find((b) => b.type === 'product')!.hPct
    expect(h(withSizes)).toBeGreaterThan(h(plain))
  })

  it('закреплённые блоки остаются на месте, поток идёт ниже', () => {
    const logo: MenuBlock = {
      ...normalizeDoc({ pages: [{ id: 'p', blocks: [{ id: 'logo', type: 'logo', text: '6.7', xPct: 0, yPct: 0, wPct: 32, hPct: 7 }] }] }).pages[0]!.blocks[0]!,
      pinned: true,
    }
    const { pages } = flowSections({ sections: [section('coffee', 'Кофе', 5)], pinned: [logo] })
    const blocks = pages[0]!.blocks
    expect(blocks[0]!.id).toBe('logo')
    expect(blocks[0]!.yPct).toBe(0)
    const firstProduct = blocks.find((b) => b.type === 'product')!
    expect(firstProduct.yPct).toBeGreaterThanOrEqual(7)
  })

  it('продолжение секции на новой странице получает заголовок «(продолжение)»', () => {
    const { pages } = flowSections({ sections: [section('big', 'Кофе', 60)] })
    const headers = pages.flatMap((p) => p.blocks.filter((b) => b.type === 'category'))
    expect(headers.length).toBeGreaterThan(1)
    expect(headers.some((b) => (b.titleOverride ?? '').includes('продолжение'))).toBe(true)
  })

  it('пустая секция не оставляет висячий заголовок', () => {
    const { pages } = flowSections({ sections: [{ ...section('empty', 'Пусто', 0) }] })
    expect(pages[0]!.blocks).toHaveLength(0)
  })

  it('relayoutDoc сохраняет закреплённые блоки и секции', () => {
    const doc = normalizeDoc({
      schemaVersion: 2,
      pages: [
        {
          id: 'page-1',
          blocks: [
            { id: 'logo', type: 'logo', xPct: 0, yPct: 0, wPct: 32, hPct: 7, pinned: true },
            { id: 'old-p', type: 'product', productId: 100, xPct: 0, yPct: 30, wPct: 40, hPct: 5 },
          ],
          sections: [section('coffee', 'Кофе', 4)],
        },
      ],
    })
    const { doc: next } = relayoutDoc(doc)
    const blocks = next.pages[0]!.blocks
    expect(blocks.some((b) => b.id === 'logo')).toBe(true)
    expect(blocks.some((b) => b.id === 'old-p')).toBe(false)
    expect(next.pages[0]!.sections?.[0]?.title).toBe('Кофе')
    expect(next.schemaVersion).toBe(2)
  })
})

describe('seed создаёт секции, /layout пересобирает лист', () => {
  it('seed пишет schemaVersion 2 и секции, а не просто блоки', async () => {
    const { app } = await import('../app')
    const { db } = await import('../db')
    const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
    const cat = Number(
      db.prepare('INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,1,?,?)').run('Сезон', 0, Date.now(), Date.now()).lastInsertRowid,
    )
    for (let i = 0; i < 30; i++) {
      db.prepare('INSERT INTO products(name, price, icon, available, category_id) VALUES(?,?,?,1,?)').run(`Позиция ${i}`, 100 + i, 'Coffee', cat)
    }
    const created = await app.request('/api/admin/menu-layouts', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Секции' }) })
    const { layout } = (await created.json()) as { layout: { id: number } }
    const seeded = await app.request(`/api/admin/menu-layouts/${layout.id}/seed-from-catalog`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ categoryIds: [cat] }),
    })
    expect(seeded.status).toBe(200)
    const body = (await seeded.json()) as {
      added: number
      layout: { sections: number; schemaVersion: number; stats: { pages: number } }
    }
    expect(body.layout.schemaVersion).toBe(2)
    expect(body.layout.sections).toBe(1)
    // 30 позиций не влезают на один лист — движок переносит их на следующую страницу
    expect(body.layout.stats.pages).toBeGreaterThan(1)

    const relaid = await app.request(`/api/admin/menu-layouts/${layout.id}/layout`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ columns: 1 }),
    })
    expect(relaid.status).toBe(200)
    const next = (await relaid.json()) as { dropped: number; layout: { stats: { pages: number } } }
    expect(next.dropped).toBe(0)
  })

  it('/layout без секций отвечает 400', async () => {
    const { app } = await import('../app')
    const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
    const created = await app.request('/api/admin/menu-layouts', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Пусто' }) })
    const { layout } = (await created.json()) as { layout: { id: number } }
    const res = await app.request(`/api/admin/menu-layouts/${layout.id}/layout`, { method: 'POST', headers: H, body: JSON.stringify({}) })
    expect(res.status).toBe(400)
  })
})

describe('этап 3.4: шаблоны листа', () => {
  it('GET /menu-layouts/templates отдаёт 6 шаблонов с правилами раскладки', async () => {
    const { app } = await import('../app')
    const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
    const res = await app.request('/api/admin/menu-layouts/templates', { headers: H })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { templates: { id: string; name: string; options: { columns: number } }[] }
    expect(body.templates).toHaveLength(6)
    expect(body.templates.some((t) => t.id === 'one-column-large' && t.options.columns === 1)).toBe(true)
    expect(body.templates.some((t) => t.id === 'screen-16-9')).toBe(true)
  })

  it('seed с шаблоном меняет раскладку и ставит тему шаблона', async () => {
    const { app } = await import('../app')
    const { db } = await import('../db')
    const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
    const cat = Number(
      db.prepare('INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,1,?,?)').run('Шаблон', 0, Date.now(), Date.now()).lastInsertRowid,
    )
    for (let i = 0; i < 6; i++) {
      db.prepare('INSERT INTO products(name, price, icon, available, category_id) VALUES(?,?,?,1,?)').run(`Блюдо ${i}`, 100, 'Coffee', cat)
    }
    const created = await app.request('/api/admin/menu-layouts', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Шаблонный' }) })
    const { layout } = (await created.json()) as { layout: { id: number } }
    const res = await app.request(`/api/admin/menu-layouts/${layout.id}/seed-from-catalog`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ categoryIds: [cat], template: 'one-column-large' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { layout: { theme: { preset: string }; doc: { pages: { template?: string; blocks: { type: string; xPct: number }[] }[] } } }
    expect(body.layout.doc.pages[0]!.template).toBe('one-column-large')
    // одна колонка — все позиции начинаются с x = 0
    const products = body.layout.doc.pages[0]!.blocks.filter((b) => b.type === 'product')
    expect(products.every((b) => b.xPct === 0)).toBe(true)
  })
})
