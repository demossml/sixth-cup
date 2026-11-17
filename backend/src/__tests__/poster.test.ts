/**
 * Конструктор «Меню и Ценники»: документ в SQLite и цены из каталога.
 *
 * Главное: цена строки, привязанной к товару, всегда из базы — клиент её не перебьёт, а изменение
 * цены в каталоге ставит документы в печать и пишется в журнал.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-poster-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.ADMIN_MARKETER_TOKEN = 'test-manager'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { linkToMilk, linkToProduct } = await import('@sixth-cup/menu-core/catalog')
const { fingerprint } = await import('@sixth-cup/menu-core/fingerprint')
type SendDetails = import('@sixth-cup/menu-core/sends').SendDetails
type Workspace = import('@sixth-cup/menu-core/model').Workspace
type Catalog = import('@sixth-cup/menu-core/catalog').Catalog

const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
const now = Date.now()
const ids = { group: 9001, s: 9011, m: 9012, l: 9013, oatProduct: 9020, milkScheme: 0, oat: 0, syrup: 9030 }

beforeAll(() => {
  const coffee = Number(db.prepare('INSERT INTO categories(name, sort_order, created_at, updated_at) VALUES(?,?,?,?)').run('Кофе тест', 0, now, now).lastInsertRowid)
  const addons = Number(db.prepare('INSERT INTO categories(name, sort_order, created_at, updated_at) VALUES(?,?,?,?)').run('Добавки', 9, now, now).lastInsertRowid)
  db.prepare('INSERT INTO product_groups(id, name, category_id, sort_order, created_at, updated_at) VALUES(?,?,?,?,?,?)').run(ids.group, 'Капучино', coffee, 0, now, now)
  const product = db.prepare('INSERT INTO products(id, name, price, icon, available, category_id, group_id, variant_label, variant_sort) VALUES(?,?,?,?,1,?,?,?,?)')
  product.run(ids.s, 'Капучино 250', 200, 'Coffee', coffee, ids.group, '250 мл', 0)
  product.run(ids.m, 'Капучино 350', 230, 'Coffee', coffee, ids.group, '350 мл', 1)
  product.run(ids.l, 'Капучино 400', 260, 'Coffee', coffee, ids.group, '400 мл', 2)
  db.prepare('INSERT INTO products(id, name, price, icon, available, category_id) VALUES(?,?,?,?,1,?)').run(ids.oatProduct, 'Овсяное молоко', 60, 'Milk', addons)
  db.prepare('INSERT INTO products(id, name, price, icon, available, category_id) VALUES(?,?,?,?,1,?)').run(ids.syrup, 'Сироп ваниль', 40, 'Coffee', addons)
  ids.milkScheme = Number(db.prepare('INSERT INTO milk_schemes(name, created_at, updated_at) VALUES(?,?,?)').run('Молоко', now, now).lastInsertRowid)
  db.prepare('INSERT INTO milk_scheme_variants(scheme_id, product_id, label, is_free, sort_order) VALUES(?,?,?,0,1)').run(ids.milkScheme, null, 'Обычное')
  ids.oat = Number(db.prepare('INSERT INTO milk_scheme_variants(scheme_id, product_id, label, is_free, sort_order) VALUES(?,?,?,0,2)').run(ids.milkScheme, ids.oatProduct, 'Овсяное').lastInsertRowid)
  db.prepare('UPDATE products SET milk_scheme_id=? WHERE group_id=?').run(ids.milkScheme, ids.group)
})

beforeEach(() => {
  db.prepare('DELETE FROM poster_workspace').run()
  db.prepare('DELETE FROM poster_send_details').run()
  db.prepare("DELETE FROM app_settings WHERE key='poster_mail'").run()
  db.prepare('UPDATE products SET price=? WHERE id=?').run(230, ids.m)
})

const getWs = async () => ((await (await app.request('/api/admin/poster/workspace', { headers: H })).json()) as { ws: Workspace }).ws
const getCatalog = async () => (await (await app.request('/api/admin/poster/catalog', { headers: H })).json()) as Catalog
const putWs = (ws: Workspace, baseRev = ws.rev) =>
  app.request('/api/admin/poster/workspace', { method: 'PUT', headers: H, body: JSON.stringify({ ws, baseRev }) })

/** Привязать «Капучино» и «Овсяное» из стартового меню к каталогу и сохранить. */
async function linkedWs() {
  const ws = await getWs()
  const cat = await getCatalog()
  const g = ws.groups.find((x) => x.id === 'g-coffee')!
  const item = g.items.find((i) => i.name === 'Капучино')!
  const product = cat.products.find((p) => p.id === `g:${ids.group}`)!
  linkToProduct(g, item, product)
  linkToMilk(item.variations.find((v) => v.name === 'Овсяное')!, product.milk.find((m) => m.id === ids.oat)!)
  const res = await putWs(ws)
  expect(res.status).toBe(200)
  return ((await res.json()) as { ws: Workspace }).ws
}

const cappuccino = (ws: Workspace) => ws.groups.find((x) => x.id === 'g-coffee')!.items.find((i) => i.name === 'Капучино')!

describe('poster: catalog', () => {
  it('builds a group with sizes, milk surcharges and add-ons from the database', async () => {
    const cat = await getCatalog()
    const cap = cat.products.find((p) => p.id === `g:${ids.group}`)!
    expect(cap).toMatchObject({ name: 'Капучино', addon: false, available: true })
    expect(cap.sizes.map(({ updatedAt, ...size }) => size)).toEqual([
      { key: `p:${ids.s}`, label: '250 мл', price: 200 },
      { key: `p:${ids.m}`, label: '350 мл', price: 230 },
      { key: `p:${ids.l}`, label: '400 мл', price: 260 },
    ])
    expect(cap.milk.find((m) => m.id === ids.oat)).toEqual({ id: ids.oat, label: 'Овсяное', surcharge: 60 })
    expect(cat.products.find((p) => p.id === `p:${ids.syrup}`)).toMatchObject({ addon: true, sizes: [{ price: 40 }] })
    // размеры группы не дублируются отдельными товарами
    expect(cat.products.some((p) => p.id === `p:${ids.m}`)).toBe(false)
  })

  it('requires the admin token', async () => {
    expect((await app.request('/api/admin/poster/catalog')).status).toBe(403)
  })
})


describe('poster: prices from the editor', () => {
  const H2 = { ...H, 'Content-Type': 'application/json' }
  const setPrices = (updates: unknown) => app.request('/api/admin/poster/catalog/prices', { method: 'POST', headers: H2, body: JSON.stringify({ updates }) })

  it('stamps when a size price changed in the base', async () => {
    const before = (await getCatalog()).products.find((p) => p.id === `g:${ids.group}`)!.sizes.find((x) => x.key === `p:${ids.l}`)!
    const res = await setPrices([{ ref: `g:${ids.group}`, key: `p:${ids.l}`, price: 275 }])
    expect(res.status).toBe(200)
    const after = ((await res.json()) as { catalog: Catalog }).catalog.products.find((p) => p.id === `g:${ids.group}`)!.sizes.find((x) => x.key === `p:${ids.l}`)!
    expect(after.price).toBe(275)
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt ?? 0)
    expect((db.prepare('SELECT price FROM products WHERE id=?').get(ids.l) as { price: number }).price).toBe(275)
    db.prepare('UPDATE products SET price=? WHERE id=?').run(260, ids.l)
  })

  it('refuses a size that does not belong to the row and writes nothing', async () => {
    const res = await setPrices([
      { ref: `g:${ids.group}`, key: `p:${ids.s}`, price: 1 },
      { ref: `g:${ids.group}`, key: `p:${ids.syrup}`, price: 1 },
    ])
    expect(res.status).toBe(409)
    expect((db.prepare('SELECT price FROM products WHERE id=?').get(ids.s) as { price: number }).price).toBe(200)
    expect((await setPrices([{ ref: `g:${ids.group}`, key: `p:${ids.s}`, price: -5 }])).status).toBe(409)
    expect((await setPrices([])).status).toBe(400)
  })

  it('keeps a «menu only» price on save while other columns follow the base', async () => {
    const ws = await linkedWs()
    const item = cappuccino(ws)
    item.prices[1] = 199
    item.link!.manual = [1]
    const res = await putWs(ws)
    expect(res.status).toBe(200)
    const saved = cappuccino(((await res.json()) as { ws: Workspace }).ws)
    expect(saved.prices).toEqual([200, 199, 260])
    db.prepare('UPDATE products SET price=? WHERE id=?').run(240, ids.m)
    expect(cappuccino(await getWs()).prices[1]).toBe(199)
  })
})

describe('poster: workspace', () => {
  it('seeds on first read and rejects a save from a stale revision', async () => {
    const ws = await getWs()
    expect(ws.groups.length).toBeGreaterThan(0)
    expect((await putWs(ws)).status).toBe(200)
    const stale = await putWs(ws, ws.rev)
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as { ws: Workspace }).ws.rev).toBe(ws.rev + 1)
  })

  it('takes linked prices from the catalog; milk = size + surcharge', async () => {
    const ws = await linkedWs()
    const cap = cappuccino(ws)
    expect(cap.prices).toEqual([200, 230, 260])
    expect(cap.variations.find((v) => v.name === 'Овсяное')!.prices).toEqual([260, 290, 320])
  })

  it('does not let the client overwrite a linked price', async () => {
    const ws = await linkedWs()
    cappuccino(ws).prices[1] = 999
    const saved = ((await (await putWs(ws)).json()) as { ws: Workspace }).ws
    expect(cappuccino(saved).prices[1]).toBe(230)
  })

  it('applies a catalog price change, queues it for printing and logs it', async () => {
    await linkedWs()
    db.prepare('UPDATE products SET price=? WHERE id=?').run(240, ids.m)
    const ws = await getWs()
    const cap = cappuccino(ws)
    expect(cap.prices).toEqual([200, 240, 260])
    expect(cap.priceNotice?.at).toBeTruthy()
    expect(cap.variations.find((v) => v.name === 'Овсяное')!.prices[1]).toBe(300)
    expect(ws.changeLog.map((e) => e.text)).toContain('Цена из базы: Капучино 0.35: 230 → 240')
  })

  it('marks documents sent without an email', async () => {
    const ws = await getWs()
    const doc = ws.documents[0]!
    const res = await app.request('/api/admin/poster/mark', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ docs: [{ id: doc.id, hash: 'h1', file: 'menu.pdf' }], note: 'флешка' }),
    })
    expect(res.status).toBe(200)
    const after = ((await res.json()) as { ws: Workspace }).ws
    expect(after.documents.find((d) => d.id === doc.id)!.lastSent?.hash).toBe('h1')
    expect(after.sends.at(-1)).toMatchObject({ to: 'флешка', files: ['menu.pdf'] })
  })
})

const mailBody = { host: 'smtp.example.test', port: 465, user: 'cafe@example.test', pass: 'app-pass-123', fromName: 'Кафе 6.7' }
const putMail = (body: unknown, token = 'test-admin') =>
  app.request('/api/admin/poster/mail', { method: 'PUT', headers: { ...H, 'X-Admin-Token': token }, body: JSON.stringify(body) })

describe('poster: mail settings', () => {
  it('stores the password encrypted, never returns it, and keeps it when the form leaves it empty', async () => {
    const before = await (await app.request('/api/admin/poster/mail', { headers: H })).json()
    expect(before).toMatchObject({ configured: false, source: null })

    const res = await putMail(mailBody)
    expect(res.status).toBe(200)
    const saved = await res.json()
    expect(saved).toMatchObject({ configured: true, source: 'settings', host: 'smtp.example.test', user: 'cafe@example.test', from: 'cafe@example.test', fromName: 'Кафе 6.7', hasPassword: true })
    expect(JSON.stringify(saved)).not.toContain('app-pass-123')
    const raw = (db.prepare("SELECT value FROM app_settings WHERE key='poster_mail'").get() as { value: string }).value
    expect(raw).not.toContain('app-pass-123')

    const again = await putMail({ ...mailBody, pass: '', port: 587 })
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ configured: true, port: 587 })
  })

  it('requires a password the first time and an email-like sender', async () => {
    const noPass = await putMail({ ...mailBody, pass: '' })
    expect(noPass.status).toBe(400)
    expect((await noPass.json()).error).toContain('пароль')
    const badFrom = await putMail({ ...mailBody, from: 'не почта' })
    expect(badFrom.status).toBe(400)
  })

  it('disconnects, and managers cannot change mail settings', async () => {
    await putMail(mailBody)
    const off = await app.request('/api/admin/poster/mail', { method: 'DELETE', headers: H })
    expect(await off.json()).toMatchObject({ configured: false })
    const manager = await putMail(mailBody, 'test-manager')
    expect(manager.status).toBe(403)
    expect((await manager.json()).error).toBe('Insufficient role')
  })

  it('refuses to send a letter when mail is not connected', async () => {
    const form = new FormData()
    form.set('zip', new File([new Uint8Array([1])], 'a.zip'))
    form.set('to', 'print@example.test')
    form.set('docs', JSON.stringify([{ id: 'x', hash: 'h', file: 'a.pdf' }]))
    const res = await app.request('/api/admin/poster/send', { method: 'POST', headers: { 'X-Admin-Token': 'test-admin' }, body: form })
    expect(res.status).toBe(503)
  })
})

describe('poster: send history', () => {
  const mark = async (ws: Workspace, docId: string) => {
    const doc = ws.documents.find((d) => d.id === docId)!
    const res = await app.request('/api/admin/poster/mark', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ docs: [{ id: doc.id, hash: fingerprint(ws, doc), file: `${doc.name}.pdf` }], note: 'флешка' }),
    })
    expect(res.status).toBe(200)
    const after = ((await res.json()) as { ws: Workspace }).ws
    return { ws: after, sendId: after.sends.at(-1)!.id }
  }
  const details = async (id: string) => (await (await app.request(`/api/admin/poster/sends/${id}`, { headers: H })).json()) as SendDetails

  it('records what was sent, what changed since the previous send and the previous version', async () => {
    const ws = await linkedWs()
    const menu = ws.documents.find((d) => d.kind === 'menu' && d.groupIds.includes('g-coffee'))!

    const first = await mark(ws, menu.id)
    const d1 = await details(first.sendId)
    expect(d1).toMatchObject({ method: 'manual', to: 'флешка' })
    expect(d1.docs[0]).toMatchObject({ id: menu.id, kind: 'menu', changes: { state: 'new' } })
    expect(d1.docs[0].snap).toBeTruthy()
    expect(d1.docs[0].prev).toBeUndefined()

    db.prepare('UPDATE products SET price=? WHERE id=?').run(240, ids.m)
    const fresh = await getWs() // цены из базы встают в меню
    const second = await mark(fresh, menu.id)
    const d2 = await details(second.sendId)
    expect(d2.docs[0].changes.state).toBe('changed')
    expect(d2.docs[0].changes.prices).toContainEqual({ what: 'Капучино 0.35', from: 230, to: 240 })
    expect(d2.docs[0].prev).toMatchObject({ sendId: first.sendId })
    expect(d2.docs[0].prev?.snap).toBeTruthy()
    expect(d2.log.map((e) => e.text)).toContain('Цена из базы: Капучино 0.35: 230 → 240')
  })

  it('gives light previews for the list: sent copies without previous versions, unknown ids skipped', async () => {
    const ws = await linkedWs()
    const menu = ws.documents.find((d) => d.kind === 'menu' && d.groupIds.includes('g-coffee'))!
    const first = await mark(ws, menu.id)
    const second = await mark(await getWs(), menu.id)
    const res = await app.request(`/api/admin/poster/sends/previews?ids=${first.sendId},${second.sendId},nope`, { headers: H })
    expect(res.status).toBe(200)
    const { previews } = (await res.json()) as { previews: { id: string; snippet: string | null; docs: { id: string; snap?: unknown; prev?: unknown }[] }[] }
    expect(previews.map((p) => p.id)).toEqual([first.sendId, second.sendId])
    expect(previews[1].docs[0]).toMatchObject({ id: menu.id })
    expect(previews[1].docs[0].snap).toBeTruthy()
    expect(previews[1].docs[0].prev).toBeUndefined()
    expect(previews[1].snippet).toBeNull() // отметка вручную — письма нет
    expect((await app.request('/api/admin/poster/sends/previews', { headers: H })).status).toBe(400)
  })

  it('falls back to what the workspace remembers for sends made before details were stored', async () => {
    const ws = await getWs()
    const doc = ws.documents[0]!
    const { sendId } = await mark(ws, doc.id)
    db.prepare('DELETE FROM poster_send_details WHERE send_id=?').run(sendId)
    const d = await details(sendId)
    expect(d.legacy).toBe(true)
    expect(d.docs[0]).toMatchObject({ id: doc.id, changes: { state: 'unknown' } })
    expect(d.docs[0].snap).toBeTruthy() // последняя отправка документа — копия есть в lastSent
    expect((await app.request('/api/admin/poster/sends/nope', { headers: H })).status).toBe(404)
  })
})
