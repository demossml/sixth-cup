/**
 * P3-2: «Обновить с каталога» с предпросмотром — было → стало и выборочное применение.
 *
 * Снапшоты цен ставит сам сервер (sync-prices), поэтому сценарий повторяет жизнь:
 * сохранили макет → цена в каталоге изменилась → посмотрели diff → применили выборочно.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-catalog-diff-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')

const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }

let catSeq = 0
const mkProduct = (name: string, price: number) => {
  const now = Date.now()
  catSeq++
  const cat = db
    .prepare('INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,1,?,?)')
    .run('Тест', catSeq, now, now)
  return Number(
    db
      .prepare(
        `INSERT INTO products(name, price, category_id, available, created_at, updated_at)
         VALUES(?,?,?,1,?,?)`,
      )
      .run(name, price, Number(cat.lastInsertRowid), now, now).lastInsertRowid,
  )
}

const setPrice = (productId: number, price: number) =>
  db.prepare('UPDATE products SET price=?, updated_at=? WHERE id=?').run(price, Date.now(), productId)

const mkLayout = async (doc: unknown) => {
  const created = await app.request('/api/admin/menu-layouts', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ title: 'Diff' }),
  })
  const { layout } = (await created.json()) as { layout: { id: number } }
  await app.request(`/api/admin/menu-layouts/${layout.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ doc }) })
  return layout.id as number
}

const block = (id: string, productId: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'product',
  xPct: 0,
  yPct: 0,
  wPct: 50,
  hPct: 6,
  productId,
  zIndex: 0,
  sortOrder: 0,
  ...extra,
})

const docWith = (blocks: unknown[]) => ({ pages: [{ id: 'p1', blocks }] })

const sync = (id: number, blocks?: string[]) =>
  app.request(`/api/admin/menu-layouts/${id}/sync-prices`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(blocks ? { blocks } : {}),
  })

const diff = async (id: number) =>
  (await (await app.request(`/api/admin/menu-layouts/${id}/catalog-diff`, { headers: H })).json()) as {
    changes: {
      blockId: string
      productId: number
      missing: boolean
      price: { from: number | null; to: number | null } | null
      name: { from: string; to: string } | null
      sizes: { from: string; to: string } | null
      manualPrice: boolean
    }[]
    frozen: boolean
  }

beforeEach(() => {
  db.prepare('DELETE FROM menu_layout_shares').run()
  db.prepare('DELETE FROM menu_layouts').run()
  db.prepare('DELETE FROM products').run()
  db.prepare('DELETE FROM categories').run()
})

describe('P3-2: diff каталога', () => {
  it('показывает изменение цены, пока ничего не применяя', async () => {
    const product = mkProduct('Латте', 150)
    const id = await mkLayout(docWith([block('b1', product)]))
    await sync(id) // снапшот 150
    setPrice(product, 200)

    const res = await diff(id)
    expect(res.changes).toHaveLength(1)
    expect(res.changes[0]!.price).toEqual({ from: 150, to: 200 })

    // Документ не изменился: diff — только чтение.
    const after = (await (await app.request(`/api/admin/menu-layouts/${id}`, { headers: H })).json()) as {
      layout: { doc: { pages: { blocks: { snapshotPriceRub?: number }[] }[] } }
    }
    expect(after.layout.doc.pages[0]!.blocks[0]!.snapshotPriceRub).toBe(150)
  })

  it('позиция пропала из каталога — помечаем missing, цену не предлагаем', async () => {
    const product = mkProduct('Сезонный', 300)
    const id = await mkLayout(docWith([block('b1', product)]))
    await sync(id)
    db.prepare('DELETE FROM products WHERE id=?').run(product)

    const res = await diff(id)
    expect(res.changes[0]!.missing).toBe(true)
    expect(res.changes[0]!.price).toBeNull()
  })

  it('ручная цена в макете не перезаписывается и не считается изменением', async () => {
    const product = mkProduct('Раф', 260)
    const id = await mkLayout(docWith([block('b1', product, { priceRubOverride: 250 })]))
    await sync(id)
    setPrice(product, 300)

    // Цена задана вручную — обновлять нечего, поэтому строки в diff нет совсем.
    const res = await diff(id)
    expect(res.changes).toHaveLength(0)
  })

  it('выборочное обновление трогает только выбранные блоки', async () => {
    const a = mkProduct('Американо', 100)
    const b = mkProduct('Флэт уайт', 100)
    const id = await mkLayout(docWith([block('b1', a), block('b2', b)]))
    await sync(id)
    setPrice(a, 180)
    setPrice(b, 240)

    const res = await sync(id, ['b1'])
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      changed: { blockId: string }[]
      layout: { doc: { pages: { blocks: { id: string; snapshotPriceRub?: number }[] }[] } }
    }
    expect(body.changed.map((c) => c.blockId)).toEqual(['b1'])
    const blocks = body.layout.doc.pages[0]!.blocks
    expect(blocks.find((x) => x.id === 'b1')!.snapshotPriceRub).toBe(180)
    // Второй блок не тронут — иначе «выборочно» было бы фикцией.
    expect(blocks.find((x) => x.id === 'b2')!.snapshotPriceRub).toBe(100)

    // В diff остался только второй блок.
    const rest = await diff(id)
    expect(rest.changes.map((c) => c.blockId)).toEqual(['b2'])
    expect(rest.changes[0]!.price).toEqual({ from: 100, to: 240 })
  })

  it('без списка блоков обновляется всё, и после этого diff пустой', async () => {
    const product = mkProduct('Капучино', 150)
    const id = await mkLayout(docWith([block('b1', product)]))
    await sync(id)
    setPrice(product, 220)
    expect((await diff(id)).changes).toHaveLength(1)

    await sync(id)
    expect((await diff(id)).changes).toHaveLength(0)
  })

  it('смена названия попадает в diff как «было → стало»', async () => {
    const product = mkProduct('Флет уайт', 240)
    const id = await mkLayout(docWith([block('b1', product)]))
    await sync(id)
    db.prepare('UPDATE products SET name=? WHERE id=?').run('Флэт уайт', product)

    const res = await diff(id)
    expect(res.changes[0]!.name).toEqual({ from: 'Флет уайт', to: 'Флэт уайт' })
  })
})
