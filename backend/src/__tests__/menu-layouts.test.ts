/**
 * Макет меню: CRUD, снапшоты цен, сборка из каталога и PDF-экспорт.
 *
 * Главное, что проверяем: сохранение переживает перезагрузку (данные в БД, не в памяти),
 * скрытие позиции в макете не трогает товар каталога, а PDF отдаётся файлом с вектором текста.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-menu-layouts-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { normalizeDoc, flowPage, normalizeTheme } = await import('../modules/admin/menuLayoutDoc')

const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }

type Block = {
  id: string
  type: string
  productId?: number | null
  titleOverride?: string | null
  priceRubOverride?: number | null
  priceText?: string | null
  showPhoto?: boolean
  hidden?: boolean
  sortOrder?: number
  text?: string | null
  displayName?: string
  displayPrice?: string | null
  warnings?: string[]
}

type LayoutBody = {
  ok?: boolean
  layout: {
    id: number
    title: string
    priceMode: 'live' | 'frozen'
    frozenAt: number | null
    stats: { pages: number; products: number; warnings: number }
    drift: { blockId: string; from: number | null; to: number | null }[]
    blockers: { code: string }[]
    theme: { columns: number; preset: string }
    doc: { pages: { id: string; blocks: Block[] }[] }
  }
  changed?: { blockId: string; from: number | null; to: number | null }[]
  applied?: boolean
  savedAt?: number
}

let productSeq = 100

function mkProduct(name: string, price: number, categoryId: number | null, imageUrl: string | null = null): number {
  const id = ++productSeq
  db.prepare(
    'INSERT INTO products(id, name, price, icon, available, category_id, image_url) VALUES(?,?,?,?,1,?,?)',
  ).run(id, name, price, 'Coffee', categoryId, imageUrl)
  return id
}

function mkCategory(name: string): number {
  const now = Date.now()
  const info = db
    .prepare('INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,1,?,?)')
    .run(name, 0, now, now)
  return Number(info.lastInsertRowid)
}

async function createLayout(title = 'Летнее меню'): Promise<LayoutBody['layout']> {
  const res = await app.request('/api/admin/menu-layouts', { method: 'POST', headers: H, body: JSON.stringify({ title }) })
  expect(res.status).toBe(201)
  return ((await res.json()) as LayoutBody).layout
}

const put = async (id: number, body: unknown) => {
  const res = await app.request(`/api/admin/menu-layouts/${id}`, { method: 'PUT', headers: H, body: JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as LayoutBody & { error?: string } }
}

const getLayout = async (id: number): Promise<LayoutBody['layout']> => {
  const res = await app.request(`/api/admin/menu-layouts/${id}`, { headers: H })
  expect(res.status).toBe(200)
  return ((await res.json()) as LayoutBody).layout
}

function docWith(blocks: Block[]) {
  return { pages: [{ id: 'page-1', blocks }] }
}

beforeEach(() => {
  db.prepare('DELETE FROM menu_layouts').run()
})

describe('макет меню: CRUD и сохранение', () => {
  it('создаёт макет с шапкой и hero, отдаёт список', async () => {
    const created = await createLayout()
    expect(created.title).toBe('Летнее меню')
    expect(created.doc.pages).toHaveLength(1)
    expect(created.doc.pages[0]!.blocks.map((b) => b.type)).toEqual(['header', 'hero'])

    const list = await app.request('/api/admin/menu-layouts', { headers: H })
    const { layouts } = (await list.json()) as { layouts: { id: number; title: string; preview: { theme: unknown } }[] }
    expect(layouts).toHaveLength(1)
    expect(layouts[0]!.id).toBe(created.id)
    expect(layouts[0]!.preview.theme).toBeTruthy()
  })

  it('сохранённый документ переживает «перезагрузку» (читаем из БД заново)', async () => {
    const created = await createLayout()
    const productId = mkProduct('Капучино', 169, null)
    const { status, body } = await put(created.id, {
      doc: docWith([
        { id: 'cat-1', type: 'category', titleOverride: 'Кофе', sortOrder: 0 },
        { id: 'p-1', type: 'product', productId, sortOrder: 1, showPhoto: false },
      ]),
      theme: { preset: 'dark', columns: 3 },
    })
    expect(status).toBe(200)
    expect(body.savedAt).toBeTypeOf('number')

    const reloaded = await getLayout(created.id)
    expect(reloaded.theme.preset).toBe('dark')
    expect(reloaded.theme.columns).toBe(3)
    const blocks = reloaded.doc.pages[0]!.blocks
    expect(blocks.map((b) => b.id)).toEqual(['cat-1', 'p-1'])
    expect(blocks[1]!.displayName).toBe('Капучино')
    expect(blocks[1]!.displayPrice).toBe('169')
  })

  it('скрытая позиция остаётся в БД макета, но не попадает в рендер и не трогает каталог', async () => {
    const productId = mkProduct('Латте', 189, null)
    const created = await createLayout()
    await put(created.id, {
      doc: docWith([
        { id: 'cat-1', type: 'category', titleOverride: 'Кофе', sortOrder: 0 },
        { id: 'p-1', type: 'product', productId, sortOrder: 1 },
        { id: 'p-2', type: 'product', productId, sortOrder: 2, hidden: true },
      ]),
    })
    const view = await getLayout(created.id)
    expect(view.doc.pages[0]!.blocks.map((b) => b.id)).toEqual(['cat-1', 'p-1'])
    expect(view.stats.products).toBe(1)
    const row = db.prepare('SELECT available FROM products WHERE id=?').get(productId) as { available: number }
    expect(row.available).toBe(1)
  })

  it('override названия и цены сильнее каталога', async () => {
    const productId = mkProduct('Раф', 259, null)
    const created = await createLayout()
    await put(created.id, {
      doc: docWith([
        { id: 'p-1', type: 'product', productId, titleOverride: 'Раф ванильный', priceText: '259 / 319', sortOrder: 0 },
      ]),
    })
    const b = (await getLayout(created.id)).doc.pages[0]!.blocks[0]!
    expect(b.displayName).toBe('Раф ванильный')
    expect(b.displayPrice).toBe('259 / 319')
  })

  it('удалённый из каталога товар даёт предупреждение и блокер', async () => {
    const productId = mkProduct('Сезонный', 199, null)
    const created = await createLayout()
    await put(created.id, { doc: docWith([{ id: 'p-1', type: 'product', productId, sortOrder: 0 }]) })
    db.prepare('DELETE FROM products WHERE id=?').run(productId)
    const view = await getLayout(created.id)
    expect(view.doc.pages[0]!.blocks[0]!.warnings).toContain('позиции больше нет в каталоге')
    expect(view.blockers.some((b) => b.code === 'missing_product')).toBe(true)
  })

  it('дубликат и удаление', async () => {
    const created = await createLayout('Копируемый')
    const dup = await app.request(`/api/admin/menu-layouts/${created.id}/duplicate`, { method: 'POST', headers: H })
    expect(dup.status).toBe(201)
    const copy = ((await dup.json()) as LayoutBody).layout
    expect(copy.title).toBe('Копируемый — копия')

    const del = await app.request(`/api/admin/menu-layouts/${created.id}`, { method: 'DELETE', headers: H })
    expect(del.status).toBe(200)
    const missing = await app.request(`/api/admin/menu-layouts/${created.id}`, { headers: H })
    expect(missing.status).toBe(404)
  })

  it('пустое название отклоняется', async () => {
    const res = await app.request('/api/admin/menu-layouts', { method: 'POST', headers: H, body: JSON.stringify({ title: '   ' }) })
    expect(res.status).toBe(400)
  })
})

describe('макет меню: цены live / frozen', () => {
  it('live показывает цену каталога, drift считает расхождение со снапшотом', async () => {
    const productId = mkProduct('Фильтр', 200, null)
    const created = await createLayout()
    await put(created.id, { doc: docWith([{ id: 'p-1', type: 'product', productId, sortOrder: 0 }]) })
    db.prepare('UPDATE products SET price=? WHERE id=?').run(240, productId)
    const view = await getLayout(created.id)
    expect(view.doc.pages[0]!.blocks[0]!.displayPrice).toBe('240')
    expect(view.drift).toEqual([{ blockId: 'p-1', pageId: 'page-1', title: 'Фильтр', from: 200, to: 240 }])
  })

  it('sync-prices в live обновляет снапшот и сообщает об изменениях', async () => {
    const productId = mkProduct('Мокка', 239, null)
    const created = await createLayout()
    await put(created.id, { doc: docWith([{ id: 'p-1', type: 'product', productId, sortOrder: 0 }]) })
    db.prepare('UPDATE products SET price=? WHERE id=?').run(249, productId)

    const res = await app.request(`/api/admin/menu-layouts/${created.id}/sync-prices`, { method: 'POST', headers: H })
    const body = (await res.json()) as LayoutBody
    expect(body.applied).toBe(true)
    expect(body.changed?.[0]).toMatchObject({ blockId: 'p-1', from: 239, to: 249 })
    expect((await getLayout(created.id)).drift).toEqual([])
  })

  it('frozen держит зафиксированную цену и не переписывает её при sync', async () => {
    const productId = mkProduct('Американо', 149, null)
    const created = await createLayout()
    await put(created.id, { doc: docWith([{ id: 'p-1', type: 'product', productId, sortOrder: 0 }]) })
    const frozen = await put(created.id, { priceMode: 'frozen' })
    expect(frozen.body.layout.priceMode).toBe('frozen')
    expect(frozen.body.layout.frozenAt).toBeTypeOf('number')

    db.prepare('UPDATE products SET price=? WHERE id=?').run(199, productId)
    const view = await getLayout(created.id)
    expect(view.doc.pages[0]!.blocks[0]!.displayPrice).toBe('149')

    const sync = await app.request(`/api/admin/menu-layouts/${created.id}/sync-prices`, { method: 'POST', headers: H })
    const body = (await sync.json()) as LayoutBody
    expect(body.applied).toBe(false)
    expect(body.changed?.[0]).toMatchObject({ from: 149, to: 199 })
    expect((await getLayout(created.id)).doc.pages[0]!.blocks[0]!.displayPrice).toBe('149')
  })
})

describe('макет меню: сборка из каталога и PDF', () => {
  it('seed-from-catalog добавляет категории и доступные позиции', async () => {
    const cat = mkCategory('Кофе')
    mkProduct('Эспрессо', 120, cat)
    mkProduct('Капучино', 169, cat)
    const hidden = mkProduct('Скрытый', 100, cat)
    db.prepare('UPDATE products SET available=0 WHERE id=?').run(hidden)

    const created = await createLayout()
    const res = await app.request(`/api/admin/menu-layouts/${created.id}/seed-from-catalog`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as LayoutBody & { added: number }
    expect(body.added).toBeGreaterThanOrEqual(2)
    const types = body.layout.doc.pages[0]!.blocks.map((b) => b.type)
    expect(types).toContain('category')
    expect(types.filter((t) => t === 'product').length).toBeGreaterThanOrEqual(2)
  })

  it('PDF отдаётся файлом с вектором текста (ToUnicode), а не растром', async () => {
    const productId = mkProduct('Капучино', 169, null)
    const created = await createLayout('Меню для печати')
    await put(created.id, {
      doc: docWith([
        { id: 'cat-1', type: 'category', titleOverride: 'Кофе', sortOrder: 0 },
        { id: 'p-1', type: 'product', productId, sortOrder: 1 },
        { id: 'p-2', type: 'product', productId, titleOverride: 'Латте', priceText: '189 / 269', sortOrder: 2 },
      ]),
    })
    const res = await app.request(`/api/admin/menu-layouts/${created.id}/export.pdf?preset=print&bleed=3`, { headers: H })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="menu-')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.includes(Buffer.from('ToUnicode'))).toBe(true)
    expect(buf.includes(Buffer.from('FontFile2'))).toBe(true)
    expect(buf.length).toBeGreaterThan(2000)
  })

  it('multi-page: две страницы дают многостраничный PDF', async () => {
    const created = await createLayout()
    await put(created.id, {
      doc: {
        pages: [
          { id: 'page-1', blocks: [{ id: 'hero-1', type: 'hero', titleOverride: 'Стр. 1', sortOrder: 0 }] },
          { id: 'page-2', blocks: [{ id: 'hero-2', type: 'hero', titleOverride: 'Стр. 2', sortOrder: 0 }] },
        ],
      },
    })
    const res = await app.request(`/api/admin/menu-layouts/${created.id}/export.pdf?preset=screen`, { headers: H })
    const buf = Buffer.from(await res.arrayBuffer())
    const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(pageCount).toBe(2)
  })

  it('без цены PDF не отдаётся молча: 409 со списком, force=1 скачивает', async () => {
    const created = await createLayout()
    await put(created.id, {
      doc: docWith([{ id: 'p-1', type: 'product', productId: 999999, sortOrder: 0 }]),
    })
    const blocked = await app.request(`/api/admin/menu-layouts/${created.id}/export.pdf`, { headers: H })
    expect(blocked.status).toBe(409)
    const body = (await blocked.json()) as { error: string; blockers: unknown[] }
    expect(body.error).toBe('has_blockers')
    expect(body.blockers.length).toBeGreaterThan(0)

    const forced = await app.request(`/api/admin/menu-layouts/${created.id}/export.pdf?force=1`, { headers: H })
    expect(forced.status).toBe(200)
    const buf = Buffer.from(await forced.arrayBuffer())
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})

describe('раскладка страницы', () => {
  const block = (type: string, id: string): Block & { warnings: string[] } => ({ id, type, warnings: [] })

  it('категории уходят в колонки, блоки после них — в подвал', () => {
    const blocks = [
      block('header', 'h'),
      block('category', 'c1'),
      block('product', 'p1'),
      block('product', 'p2'),
      block('category', 'c2'),
      block('product', 'p3'),
      block('note', 'n1'),
    ]
    const flow = flowPage(blocks as never, 2)
    expect(flow.lead.map((b) => b.id)).toEqual(['h'])
    expect(flow.tail.map((b) => b.id)).toEqual(['n1'])
    expect(flow.columns.length).toBe(2)
    expect(flow.columns[0]![0]!.category!.id).toBe('c1')
    expect(flow.columns[1]![0]!.category!.id).toBe('c2')
  })

  it('одна колонка не теряет категории', () => {
    const blocks = [block('category', 'c1'), block('product', 'p1'), block('category', 'c2'), block('product', 'p2')]
    const flow = flowPage(blocks as never, 1)
    expect(flow.columns).toHaveLength(1)
    expect(flow.columns[0]!.map((g) => g.category!.id)).toEqual(['c1', 'c2'])
  })
})

describe('нормализация документа и темы', () => {
  it('мусор в doc не ломает чтение', () => {
    const doc = normalizeDoc({ pages: [{ id: 'p', blocks: [{ type: 'unknown' }, null, { type: 'product', productId: '42' }] }] })
    expect(doc.pages[0]!.blocks).toHaveLength(2)
    expect(doc.pages[0]!.blocks[1]!.productId).toBe(42)
  })

  it('невалидные цвета и колонки заменяются дефолтами', () => {
    const theme = normalizeTheme({ bg: 'red', columns: 9, headingSize: 1000, preset: 'dark' })
    expect(theme.bg).toMatch(/^#[0-9A-F]{6}$/)
    expect(theme.columns).toBe(2)
    expect(theme.headingSize).toBeLessThanOrEqual(72)
    expect(theme.preset).toBe('dark')
  })
})
