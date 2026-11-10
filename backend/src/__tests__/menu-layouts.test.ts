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
const { normalizeDoc, migrateDocToCanvas, normalizeTheme, hasCanvasPosition } = await import('../modules/admin/menuLayoutDoc')

const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }

type Block = {
  id: string
  type: string
  xPct?: number
  yPct?: number
  wPct?: number
  hPct?: number
  zIndex?: number
  url?: string | null
  fontSizePt?: number
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
    theme: { preset: string; itemSize: number; backgroundDim: number; backgroundImageUrl: string | null }
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

const rect = { xPct: 0, yPct: 0, wPct: 40, hPct: 7 }

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
  it('создаёт макет с логотипом и заголовком в координатах холста', async () => {
    const created = await createLayout()
    expect(created.title).toBe('Летнее меню')
    expect(created.doc.pages).toHaveLength(1)
    expect(created.doc.pages[0]!.blocks.map((b) => b.type)).toEqual(['logo', 'text'])
    expect(created.doc.pages[0]!.blocks.every((b) => Number.isFinite(b.xPct) && Number.isFinite(b.yPct))).toBe(true)

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
        { id: 'cat-1', type: 'category', titleOverride: 'Кофе', sortOrder: 0, ...rect },
        { id: 'p-1', type: 'product', productId, sortOrder: 1, showPhoto: false, ...rect, yPct: 10 },
      ]),
      theme: { preset: 'dark', itemSize: 12, backgroundDim: 20 },
    })
    expect(status).toBe(200)
    expect(body.savedAt).toBeTypeOf('number')

    const reloaded = await getLayout(created.id)
    expect(reloaded.theme.preset).toBe('dark')
    expect(reloaded.theme.itemSize).toBe(12)
    expect(reloaded.theme.backgroundDim).toBe(20)
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
        { id: 'cat-1', type: 'category', titleOverride: 'Кофе', sortOrder: 0, ...rect },
        { id: 'p-1', type: 'product', productId, sortOrder: 1, ...rect, yPct: 10 },
        { id: 'p-2', type: 'product', productId, sortOrder: 2, hidden: true, ...rect, yPct: 20 },
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
        { id: 'p-1', type: 'product', productId, titleOverride: 'Раф ванильный', priceText: '259 / 319', sortOrder: 0, ...rect },
      ]),
    })
    const b = (await getLayout(created.id)).doc.pages[0]!.blocks[0]!
    expect(b.displayName).toBe('Раф ванильный')
    expect(b.displayPrice).toBe('259 / 319')
  })

  it('удалённый из каталога товар даёт предупреждение и блокер', async () => {
    const productId = mkProduct('Сезонный', 199, null)
    const created = await createLayout()
    await put(created.id, { doc: docWith([{ id: 'p-1', type: 'product', productId, sortOrder: 0, ...rect }]) })
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
    await put(created.id, { doc: docWith([{ id: 'p-1', type: 'product', productId, sortOrder: 0, ...rect }]) })
    db.prepare('UPDATE products SET price=? WHERE id=?').run(240, productId)
    const view = await getLayout(created.id)
    expect(view.doc.pages[0]!.blocks[0]!.displayPrice).toBe('240')
    expect(view.drift).toEqual([{ blockId: 'p-1', pageId: 'page-1', title: 'Фильтр', from: 200, to: 240 }])
  })

  it('sync-prices в live обновляет снапшот и сообщает об изменениях', async () => {
    const productId = mkProduct('Мокка', 239, null)
    const created = await createLayout()
    await put(created.id, { doc: docWith([{ id: 'p-1', type: 'product', productId, sortOrder: 0, ...rect }]) })
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
    await put(created.id, { doc: docWith([{ id: 'p-1', type: 'product', productId, sortOrder: 0, ...rect }]) })
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

  it('повторный seed не плодит позиции: дубли пропускаются', async () => {
    const cat = mkCategory('Кофе')
    mkProduct('Эспрессо', 120, cat)
    mkProduct('Капучино', 169, cat)
    const created = await createLayout()

    const seed = async () => {
      const res = await app.request(`/api/admin/menu-layouts/${created.id}/seed-from-catalog`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ categoryIds: [cat] }),
      })
      expect(res.status).toBe(200)
      return (await res.json()) as LayoutBody & { added: number; skippedDuplicate: number }
    }

    const first = await seed()
    expect(first.added).toBe(2)
    expect(first.skippedDuplicate).toBe(0)
    const blocksAfterFirst = first.layout.doc.pages[0]!.blocks

    const second = await seed()
    expect(second.added).toBe(0)
    expect(second.skippedDuplicate).toBe(2)
    const blocksAfterSecond = (await getLayout(created.id)).doc.pages[0]!.blocks
    expect(blocksAfterSecond).toHaveLength(blocksAfterFirst.length)

    const productIds = blocksAfterSecond.filter((b) => b.type === 'product').map((b) => b.productId)
    expect(new Set(productIds).size).toBe(productIds.length)
    expect(blocksAfterSecond.filter((b) => b.type === 'category')).toHaveLength(1)
  })

  it('seed добирает только новые позиции и не трогает блок, уже стоящий на листе', async () => {
    const cat = mkCategory('Кофе')
    const espresso = mkProduct('Эспрессо', 120, cat)
    const created = await createLayout()
    await put(created.id, {
      doc: docWith([{ id: 'espresso', type: 'product', productId: espresso, xPct: 70, yPct: 40, wPct: 20, hPct: 6, sortOrder: 0 }]),
    })
    mkProduct('Капучино', 169, cat)

    const res = await app.request(`/api/admin/menu-layouts/${created.id}/seed-from-catalog`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ categoryIds: [cat] }),
    })
    const body = (await res.json()) as LayoutBody & { added: number; skippedDuplicate: number }
    expect(body.added).toBe(1)
    expect(body.skippedDuplicate).toBe(1)
    const kept = body.layout.doc.pages[0]!.blocks.find((b) => b.id === 'espresso')
    expect(kept?.xPct).toBe(70)
  })

  it('replace сбрасывает каталог, но оставляет логотип и текст', async () => {
    const cat = mkCategory('Кофе')
    mkProduct('Эспрессо', 120, cat)
    mkProduct('Капучино', 169, cat)
    const created = await createLayout()
    await put(created.id, {
      doc: docWith([
        { id: 'logo-1', type: 'logo', xPct: 0, yPct: 0, wPct: 32, hPct: 7, sortOrder: 0 },
        { id: 'p-old', type: 'product', productId: 999999, xPct: 0, yPct: 20, wPct: 40, hPct: 6, sortOrder: 1 },
      ]),
    })
    const res = await app.request(`/api/admin/menu-layouts/${created.id}/seed-from-catalog`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ replace: true, categoryIds: [cat] }),
    })
    const body = (await res.json()) as LayoutBody & { added: number }
    const ids = body.layout.doc.pages[0]!.blocks.map((b) => b.id)
    expect(ids).toContain('logo-1')
    expect(ids).not.toContain('p-old')
    expect(body.added).toBe(2)
  })

  it('PDF отдаётся файлом с вектором текста (ToUnicode), а не растром', async () => {
    const productId = mkProduct('Капучино', 169, null)
    const created = await createLayout('Меню для печати')
    await put(created.id, {
      doc: docWith([
        { id: 'cat-1', type: 'category', titleOverride: 'Кофе', sortOrder: 0, ...rect },
        { id: 'p-1', type: 'product', productId, sortOrder: 1, ...rect, yPct: 10 },
        { id: 'p-2', type: 'product', productId, titleOverride: 'Латте', priceText: '189 / 269', sortOrder: 2, ...rect, yPct: 70 },
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

  it('картинки встраиваются в PDF, включая webp из админки', async () => {
    const sharp = (await import('sharp')).default
    const fileName = 'photo-webp.webp'
    await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 30, g: 60, b: 200 } } })
      .webp()
      .toFile(join(process.env.UPLOADS_DIR!, fileName))

    const created = await createLayout()
    await put(created.id, {
      doc: docWith([{ id: 'img-1', type: 'image', url: `/uploads/${fileName}`, sortOrder: 0, ...rect, hPct: 20 }]),
    })
    const res = await app.request(`/api/admin/menu-layouts/${created.id}/export.pdf?preset=print`, { headers: H })
    expect(res.status).toBe(200)
    const raw = Buffer.from(await res.arrayBuffer()).toString('latin1')
    expect(raw).toContain('/Subtype /Image')
  })

  it('multi-page: две страницы дают многостраничный PDF', async () => {
    const created = await createLayout()
    await put(created.id, {
      doc: {
        pages: [
          { id: 'page-1', blocks: [{ id: 't-1', type: 'text', text: 'Стр. 1', sortOrder: 0, ...rect, hPct: 12 }] },
          { id: 'page-2', blocks: [{ id: 't-2', type: 'text', text: 'Стр. 2', sortOrder: 0, ...rect, hPct: 12 }] },
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
      doc: docWith([{ id: 'p-1', type: 'product', productId: 999999, sortOrder: 0, ...rect }]),
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

describe('холст: координаты и миграция старых макетов', () => {
  const legacy = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, ...extra })

  it('блоки без координат раскладываются в сетку детерминированно', () => {
    const doc = normalizeDoc({
      pages: [
        {
          id: 'p',
          blocks: [
            legacy('h', 'header', { text: 'весна 2026', sortOrder: 0 }),
            legacy('hero', 'hero', { titleOverride: 'Кофе', text: 'меню', sortOrder: 1 }),
            legacy('c1', 'category', { titleOverride: 'Кофе', sortOrder: 2 }),
            legacy('p1', 'product', { productId: 1, sortOrder: 3 }),
            legacy('p2', 'product', { productId: 2, sortOrder: 4 }),
            legacy('note', 'note', { titleOverride: 'Заметка', sortOrder: 5 }),
          ],
        },
      ],
    })
    expect(doc.pages[0]!.blocks.some((b) => hasCanvasPosition(b))).toBe(false)

    const canvas = migrateDocToCanvas(doc)
    const blocks = canvas.pages[0]!.blocks
    expect(blocks.every((b) => hasCanvasPosition(b))).toBe(true)
    // логотип сверху, заголовок ниже, позиции в двух колонках, подвал — внизу
    const logo = blocks.find((b) => b.type === 'logo')!
    const title = blocks.find((b) => b.type === 'text' && b.fontSizePt > 20)!
    const products = blocks.filter((b) => b.type === 'product')
    expect(logo.yPct).toBe(0)
    expect(title.yPct).toBeGreaterThanOrEqual(logo.yPct)
    expect(products.length).toBe(2)
    expect(new Set(products.map((p) => p.xPct)).size).toBe(1) // обе в первой колонке
    expect(products[0]!.yPct!).toBeLessThan(products[1]!.yPct!)

    // повторная миграция ничего не двигает
    expect(JSON.stringify(migrateDocToCanvas(canvas))).toBe(JSON.stringify(canvas))
  })

  it('категории и позиции уходят во вторую колонку, когда первая заполнена', () => {
    const blocks = [legacy('c1', 'category', { titleOverride: 'Кофе' })]
    for (let i = 0; i < 6; i++) blocks.push(legacy(`p${i}`, 'product', { productId: i + 1 }))
    blocks.push(legacy('c2', 'category', { titleOverride: 'Еда' }))
    for (let i = 0; i < 6; i++) blocks.push(legacy(`e${i}`, 'product', { productId: 100 + i }))

    const canvas = migrateDocToCanvas(normalizeDoc({ pages: [{ id: 'p', blocks }] }))
    const items = canvas.pages[0]!.blocks
    const xs = [...new Set(items.map((b) => b.xPct))].sort((a, b) => a - b)
    expect(xs.length).toBe(2)
    expect(xs[1]! - xs[0]!).toBeGreaterThan(10)
  })

  it('старый photo-блок становится image, note — текстом', () => {
    const canvas = migrateDocToCanvas(
      normalizeDoc({
        pages: [
          {
            id: 'p',
            blocks: [
              legacy('c', 'category', { titleOverride: 'Кофе' }),
              legacy('photo', 'photo', { titleOverride: 'Витрина', snapshotImageUrl: '/uploads/a.jpg' }),
              legacy('note', 'note', { titleOverride: 'Хорошего дня' }),
            ],
          },
        ],
      }),
    )
    const types = canvas.pages[0]!.blocks.map((b) => b.type)
    expect(types).toContain('image')
    expect(types).toContain('text')
    const img = canvas.pages[0]!.blocks.find((b) => b.type === 'image')!
    expect(img.url).toBe('/uploads/a.jpg')
  })

  it('координаты сохраняются как есть (PUT → GET)', async () => {
    const productId = mkProduct('Латте позиция', 189, null)
    const created = await createLayout()
    await put(created.id, {
      doc: docWith([
        { id: 'p-1', type: 'product', productId, sortOrder: 0, xPct: 61.5, yPct: 12.25, wPct: 33, hPct: 9, zIndex: 5 },
      ]),
    })
    const view = await getLayout(created.id)
    const b = view.doc.pages[0]!.blocks[0]!
    expect(b.xPct).toBe(61.5)
    expect(b.yPct).toBe(12.25)
    expect(b.wPct).toBe(33)
    expect(b.hPct).toBe(9)
    expect(b.zIndex).toBe(5)
  })

  it('zIndex определяет порядок рендера', async () => {
    const created = await createLayout()
    await put(created.id, {
      doc: docWith([
        { id: 'a', type: 'text', text: 'низ', sortOrder: 0, ...rect, zIndex: 1 },
        { id: 'b', type: 'text', text: 'верх', sortOrder: 1, ...rect, zIndex: 9 },
      ]),
    })
    const view = await getLayout(created.id)
    expect(view.doc.pages[0]!.blocks.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('нормализация документа и темы', () => {
  it('мусор в doc не ломает чтение', () => {
    const doc = normalizeDoc({ pages: [{ id: 'p', blocks: [{ type: 'unknown' }, null, { type: 'product', productId: '42' }] }] })
    expect(doc.pages[0]!.blocks).toHaveLength(2)
    expect(doc.pages[0]!.blocks[1]!.productId).toBe(42)
  })

  it('невалидные цвета и фон заменяются дефолтами', () => {
    const theme = normalizeTheme({ bg: 'red', backgroundDim: 500, backgroundImageUrl: 42, preset: 'dark' })
    expect(theme.bg).toMatch(/^#[0-9A-F]{6}$/)
    expect(theme.backgroundDim).toBeLessThanOrEqual(80)
    expect(theme.backgroundImageUrl).toBeNull()
    expect(theme.preset).toBe('dark')
  })
})
