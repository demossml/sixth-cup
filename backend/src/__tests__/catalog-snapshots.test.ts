/**
 * P3-2: сохранение макета не должно стирать расхождения с каталогом.
 *
 * `snapshotDoc` заполняет снапшоты живых цен; если звать его на каждом автосохранении,
 * правка любой плашки молча обнуляет баннер «каталог изменился» и предпросмотр diff.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-keep-snapshots-'))
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
      .prepare('INSERT INTO products(name, price, category_id, available, created_at, updated_at) VALUES(?,?,?,1,?,?)')
      .run(name, price, Number(cat.lastInsertRowid), now, now).lastInsertRowid,
  )
}

const block = (id: string, productId: number) => ({
  id,
  type: 'product',
  xPct: 0,
  yPct: 0,
  wPct: 50,
  hPct: 6,
  productId,
  zIndex: 0,
  sortOrder: 0,
})

const mkLayout = async (doc: unknown) => {
  const created = await app.request('/api/admin/menu-layouts', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ title: 'Snapshot' }),
  })
  const { layout } = (await created.json()) as { layout: { id: number; rev: number } }
  await app.request(`/api/admin/menu-layouts/${layout.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ doc }) })
  const fresh = (await (await app.request(`/api/admin/menu-layouts/${layout.id}`, { headers: H })).json()) as {
    layout: { rev: number; doc: { pages: { blocks: { id: string; snapshotPriceRub?: number }[] }[] } }
  }
  return { id: layout.id, rev: fresh.layout.rev, snap: fresh.layout.doc.pages[0]!.blocks[0]!.snapshotPriceRub }
}

const snapOf = async (id: number) => {
  const body = (await (await app.request(`/api/admin/menu-layouts/${id}`, { headers: H })).json()) as {
    layout: { rev: number; doc: { pages: { blocks: { id: string; snapshotPriceRub?: number }[] }[] } }
  }
  return { rev: body.layout.rev, snap: body.layout.doc.pages[0]!.blocks[0]!.snapshotPriceRub }
}

beforeEach(() => {
  db.prepare('DELETE FROM menu_layout_shares').run()
  db.prepare('DELETE FROM menu_layouts').run()
  db.prepare('DELETE FROM products').run()
  db.prepare('DELETE FROM categories').run()
})

describe('P3-2: снапшоты при сохранении', () => {
  it('новая позиция получает снапшот сразу', async () => {
    const product = mkProduct('Латте', 150)
    const { snap } = await mkLayout({ pages: [{ id: 'p1', blocks: [block('b1', product)] }] })
    expect(snap).toBe(150)
  })

  it('правка макета не переписывает снапшот изменившейся цены', async () => {
    const product = mkProduct('Латте', 150)
    const { id, rev } = await mkLayout({ pages: [{ id: 'p1', blocks: [block('b1', product)] }] })
    db.prepare('UPDATE products SET price=170 WHERE id=?').run(product)

    // Имитируем автосохранение: клиент прислал тот же документ (со старым снапшотом).
    await app.request(`/api/admin/menu-layouts/${id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ doc: { pages: [{ id: 'p1', blocks: [{ ...block('b1', product), snapshotPriceRub: 150 }] }] }, baseRev: rev }),
    })

    expect((await snapOf(id)).snap).toBe(150)
    const diff = (await (await app.request(`/api/admin/menu-layouts/${id}/catalog-diff`, { headers: H })).json()) as {
      changes: { price: { from: number; to: number } | null }[]
    }
    expect(diff.changes[0]!.price).toEqual({ from: 150, to: 170 })
  })

  it('переход frozen → live берёт живые цены', async () => {
    const product = mkProduct('Раф', 200)
    const { id, rev } = await mkLayout({ pages: [{ id: 'p1', blocks: [block('b1', product)] }] })
    await app.request(`/api/admin/menu-layouts/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ priceMode: 'frozen', baseRev: rev }) })
    db.prepare('UPDATE products SET price=260 WHERE id=?').run(product)

    const after = (await (await app.request(`/api/admin/menu-layouts/${id}`, { headers: H })).json()) as { layout: { rev: number } }
    await app.request(`/api/admin/menu-layouts/${id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ priceMode: 'live', baseRev: after.layout.rev }),
    })
    expect((await snapOf(id)).snap).toBe(260)
  })
})
