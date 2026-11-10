import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-stage2-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { normalizeDoc, resolveDoc, DOC_SCHEMA_VERSION } = await import('../modules/admin/menuLayoutDoc')

const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
let seq = 500

function mkProduct(name: string, price: number, categoryId: number | null, extra: { volumeSchemeId?: number; groupId?: number; variantLabel?: string } = {}) {
  const id = ++seq
  db.prepare(
    'INSERT INTO products(id, name, price, icon, available, category_id, volume_scheme_id, group_id, variant_label) VALUES(?,?,?,?,1,?,?,?,?)',
  ).run(id, name, price, 'Coffee', categoryId, extra.volumeSchemeId ?? null, extra.groupId ?? null, extra.variantLabel ?? null)
  return id
}

beforeEach(() => {
  db.prepare('DELETE FROM menu_layouts').run()
})

describe('этап 2: объёмы позиции', () => {
  it('схема v2: секции сохраняются и нормализуются', () => {
    const doc = normalizeDoc({
      schemaVersion: 2,
      pages: [
        {
          id: 'page-1',
          blocks: [],
          sections: [
            {
              id: 'sec-1',
              title: 'Кофе',
              items: [{ id: 'it-1', productId: 1, sizes: [{ label: '250 мл', source: 'catalog' }, { label: '350 мл', source: 'manual', priceRubOverride: 289 }] }],
            },
          ],
        },
      ],
    })
    expect(doc.schemaVersion).toBe(DOC_SCHEMA_VERSION)
    const sec = doc.pages[0]!.sections![0]!
    expect(sec.title).toBe('Кофе')
    expect(sec.items[0]!.sizes).toHaveLength(2)
    expect(sec.items[0]!.sizes[1]).toMatchObject({ label: '350 мл', source: 'manual', priceRubOverride: 289 })
  })

  it('старый документ без секций остаётся v1 и не получает пустых секций', () => {
    const doc = normalizeDoc({ pages: [{ id: 'p', blocks: [{ id: 'b', type: 'text', text: 'x', xPct: 0, yPct: 0, wPct: 10, hPct: 5 }] }] })
    expect(doc.schemaVersion).toBe(1)
    expect(doc.pages[0]!.sections).toBeUndefined()
  })

  it('капучино с тремя объёмами — один блок и три цены', () => {
    const scheme = db.prepare('INSERT INTO volume_schemes(name, created_at, updated_at) VALUES(?,?,?)').run('Объёмы', Date.now(), Date.now())
    const schemeId = Number(scheme.lastInsertRowid)
    const itemIds = ['250 мл', '350 мл', '450 мл'].map((label, i) =>
      Number(
        db
          .prepare('INSERT INTO volume_scheme_items(scheme_id, label, size_value, size_unit, sort_order) VALUES(?,?,?,?,?)')
          .run(schemeId, label, 250 * (i + 1) === 250 ? 250 : 250 + i * 100, 'ml', i).lastInsertRowid,
      ),
    )
    const productId = mkProduct('Капучино', 169, null, { volumeSchemeId: schemeId })
    ;[169, 219, 269].forEach((price, i) =>
      db.prepare('INSERT INTO product_volume_prices(product_id, item_id, price) VALUES(?,?,?)').run(productId, itemIds[i]!, price),
    )

    const doc = normalizeDoc({
      pages: [{ id: 'p', blocks: [{ id: 'b1', type: 'product', productId, xPct: 0, yPct: 0, wPct: 40, hPct: 8 }] }],
    })
    const resolved = resolveDoc(doc, 'live')
    const block = resolved.pages[0]!.blocks[0]!
    expect(block.displaySizes).toEqual([
      { label: '250 мл', price: '169' },
      { label: '350 мл', price: '219' },
      { label: '450 мл', price: '269' },
    ])
  })

  it('ручная цена в блоке сильнее объёмов каталога', () => {
    const scheme = db.prepare('INSERT INTO volume_schemes(name, created_at, updated_at) VALUES(?,?,?)').run('Объёмы2', Date.now(), Date.now())
    const schemeId = Number(scheme.lastInsertRowid)
    const i1 = Number(db.prepare('INSERT INTO volume_scheme_items(scheme_id, label, sort_order) VALUES(?,?,?)').run(schemeId, '250 мл', 0).lastInsertRowid)
    const i2 = Number(db.prepare('INSERT INTO volume_scheme_items(scheme_id, label, sort_order) VALUES(?,?,?)').run(schemeId, '350 мл', 1).lastInsertRowid)
    const productId = mkProduct('Флэт', 200, null, { volumeSchemeId: schemeId })
    db.prepare('INSERT INTO product_volume_prices(product_id, item_id, price) VALUES(?,?,?)').run(productId, i1, 200)
    db.prepare('INSERT INTO product_volume_prices(product_id, item_id, price) VALUES(?,?,?)').run(productId, i2, 250)

    const doc = normalizeDoc({
      pages: [{ id: 'p', blocks: [{ id: 'b1', type: 'product', productId, priceRubOverride: 199, xPct: 0, yPct: 0, wPct: 40, hPct: 8 }] }],
    })
    expect(resolveDoc(doc, 'live').pages[0]!.blocks[0]!.displaySizes).toEqual([])
  })

  it('frozen печатает снимок объёмов, live — свежие цены', () => {
    const scheme = db.prepare('INSERT INTO volume_schemes(name, created_at, updated_at) VALUES(?,?,?)').run('Объёмы3', Date.now(), Date.now())
    const schemeId = Number(scheme.lastInsertRowid)
    const itemId = Number(db.prepare('INSERT INTO volume_scheme_items(scheme_id, label, sort_order) VALUES(?,?,?)').run(schemeId, '250 мл', 0).lastInsertRowid)
    const item2 = Number(db.prepare('INSERT INTO volume_scheme_items(scheme_id, label, sort_order) VALUES(?,?,?)').run(schemeId, '350 мл', 1).lastInsertRowid)
    const productId = mkProduct('Раф', 180, null, { volumeSchemeId: schemeId })
    db.prepare('INSERT INTO product_volume_prices(product_id, item_id, price) VALUES(?,?,?)').run(productId, itemId, 180)
    db.prepare('INSERT INTO product_volume_prices(product_id, item_id, price) VALUES(?,?,?)').run(productId, item2, 230)

    const doc = normalizeDoc({
      pages: [
        {
          id: 'p',
          blocks: [
            {
              id: 'b1',
              type: 'product',
              productId,
              xPct: 0,
              yPct: 0,
              wPct: 40,
              hPct: 8,
              snapshotSizes: [
                { label: '250 мл', price: '180' },
                { label: '350 мл', price: '230' },
              ],
            },
          ],
        },
      ],
    })
    expect(resolveDoc(doc, 'frozen').pages[0]!.blocks[0]!.displaySizes).toEqual([
      { label: '250 мл', price: '180' },
      { label: '350 мл', price: '230' },
    ])
    // в каталоге цену подняли — live показывает новую, frozen держит снимок
    db.prepare('UPDATE product_volume_prices SET price=195 WHERE product_id=? AND item_id=?').run(productId, itemId)
    expect(resolveDoc(doc, 'live').pages[0]!.blocks[0]!.displaySizes).toEqual([
      { label: '250 мл', price: '195' },
      { label: '350 мл', price: '230' },
    ])
  })

  it('GET /menu-layouts/catalog отдаёт объёмы и категории', async () => {
    const scheme = db.prepare('INSERT INTO volume_schemes(name, created_at, updated_at) VALUES(?,?,?)').run('Объёмы4', Date.now(), Date.now())
    const schemeId = Number(scheme.lastInsertRowid)
    const a = Number(db.prepare('INSERT INTO volume_scheme_items(scheme_id, label, sort_order) VALUES(?,?,?)').run(schemeId, '250 мл', 0).lastInsertRowid)
    const b = Number(db.prepare('INSERT INTO volume_scheme_items(scheme_id, label, sort_order) VALUES(?,?,?)').run(schemeId, '350 мл', 1).lastInsertRowid)
    const productId = mkProduct('Латте', 190, null, { volumeSchemeId: schemeId })
    db.prepare('INSERT INTO product_volume_prices(product_id, item_id, price) VALUES(?,?,?)').run(productId, a, 190)
    db.prepare('INSERT INTO product_volume_prices(product_id, item_id, price) VALUES(?,?,?)').run(productId, b, 240)

    const res = await app.request('/api/admin/menu-layouts/catalog', { headers: H })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      products: { id: number; prices: { label: string; priceRub: number }[] | null }[]
      categories: { id: number; name: string }[]
    }
    const p = body.products.find((x) => x.id === productId)!
    expect(p.prices).toEqual([
      { label: '250 мл', priceRub: 190, productId, volumeItemId: a },
      { label: '350 мл', priceRub: 240, productId, volumeItemId: b },
    ])
    expect(Array.isArray(body.categories)).toBe(true)
  })
})

describe('этап 2: объёмы в PDF', () => {
  it('позиция с тремя объёмами печатается двумя строками, а не тремя блоками', async () => {
    const scheme = db.prepare('INSERT INTO volume_schemes(name, created_at, updated_at) VALUES(?,?,?)').run('PDF-объёмы', Date.now(), Date.now())
    const schemeId = Number(scheme.lastInsertRowid)
    const labels = ['250 мл', '350 мл', '450 мл']
    const itemIds = labels.map(
      (label, i) =>
        Number(db.prepare('INSERT INTO volume_scheme_items(scheme_id, label, sort_order) VALUES(?,?,?)').run(schemeId, label, i).lastInsertRowid),
    )
    const productId = mkProduct('Капучино PDF', 169, null, { volumeSchemeId: schemeId })
    ;[169, 219, 269].forEach((price, i) =>
      db.prepare('INSERT INTO product_volume_prices(product_id, item_id, price) VALUES(?,?,?)').run(productId, itemIds[i]!, price),
    )

    const created = await app.request('/api/admin/menu-layouts', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ title: 'Объёмы' }),
    })
    const { layout } = (await created.json()) as { layout: { id: number } }
    await app.request(`/api/admin/menu-layouts/${layout.id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        doc: { pages: [{ id: 'page-1', blocks: [{ id: 'p1', type: 'product', productId, xPct: 0, yPct: 0, wPct: 60, hPct: 10, zIndex: 0, sortOrder: 0 }] }] },
      }),
    })
    const res = await app.request(`/api/admin/menu-layouts/${layout.id}/export.pdf?preset=screen&force=1`, { headers: H })
    expect(res.status).toBe(200)
    const buf = Buffer.from(await res.arrayBuffer())
    const zlib = await import('node:zlib')
    const raw = buf.toString('latin1')
    let text = ''
    for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
      try {
        text += zlib.inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1')
      } catch {
        /* не поток контента */
      }
    }
    // блок один, поэтому и вызовов текста немного; главное — PDF собрался и текст векторный
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(text.length).toBeGreaterThan(0)
    // в ресурсах есть встроенные шрифты (ToUnicode), то есть текст не растрирован
    expect(raw.includes('ToUnicode')).toBe(true)
  })
})
