import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-console-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.ADMIN_ALLOW_RESET = '0'

const { app } = await import('../app')
const { db } = await import('../db')
const lib = await import('../modules/admin/consoleLib')
const { redactJson, entityFromPath } = await import('../modules/admin/audit')

const H = { 'X-Admin-Token': 'test-admin', 'Content-Type': 'application/json' }
const get = (p: string) => app.request('/api/admin' + p, { headers: H })
const send = (method: string, p: string, body?: unknown) => app.request('/api/admin' + p, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) })
const json = async (r: Response) => (await r.json()) as any

describe('pure helpers', () => {
  it('till health follows the 5 / 30 minute thresholds', () => {
    const now = 1_000_000_000_000
    const m = (min: number) => now - min * 60_000
    expect(lib.storeHealth({ enabled: false, status: null, lastOkAt: null }, now).level).toBe('off')
    expect(lib.storeHealth({ enabled: true, status: 'OK', lastOkAt: m(1) }, now).level).toBe('ok')
    expect(lib.storeHealth({ enabled: true, status: 'OK', lastOkAt: m(5) }, now).level).toBe('warn')
    expect(lib.storeHealth({ enabled: true, status: 'OK', lastOkAt: m(29) }, now).level).toBe('warn')
    expect(lib.storeHealth({ enabled: true, status: 'OK', lastOkAt: m(30) }, now).level).toBe('bad')
    expect(lib.storeHealth({ enabled: true, status: 'ERROR', lastOkAt: m(1) }, now).level).toBe('bad')
    expect(lib.storeHealth({ enabled: true, status: 'OK', lastOkAt: null }, now).level).toBe('bad')
    expect(lib.worstLevel(['off', 'ok', 'warn'])).toBe('warn')
    expect(lib.worstLevel(['off'])).toBe('off')
  })
  it('cursor round-trips and rejects garbage', () => {
    expect(lib.decodeCursor(lib.encodeCursor(123, 'abc'))).toEqual({ t: 123, id: 'abc' })
    expect(lib.decodeCursor('###')).toBeNull()
    expect(lib.decodeCursor(undefined)).toBeNull()
  })
  it('csv: BOM, quoting and formula-injection guard', () => {
    const csv = lib.toCsv([{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }], [{ a: 'x;y', b: '=1+1' }, { a: 'say "hi"', b: null }])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('"x;y";\'=1+1')
    expect(csv).toContain('"say ""hi""";')
  })
  it('price actions', () => {
    expect(lib.nextPrice(200, { price: 250 })).toBe(250)
    expect(lib.nextPrice(200, { priceDelta: -50 })).toBe(150)
    expect(lib.nextPrice(200, { pricePercent: 10 })).toBe(220)
    expect(lib.nextPrice(20, { priceDelta: -500 })).toBe(0)
    expect(lib.nextPrice(200, { available: false })).toBe(200)
  })
  it('audit redaction and entity detection', () => {
    expect(JSON.parse(redactJson({ name: 'x', adminToken: 'S', nested: { password: 'p', ok: 1 } })!)).toEqual({ name: 'x', adminToken: '[скрыто]', nested: { password: '[скрыто]', ok: 1 } })
    expect(redactJson({ big: 'x'.repeat(9000) })!.length).toBeLessThanOrEqual(4001)
    expect(entityFromPath('/api/admin/products/12/sync')).toEqual({ entity: 'products', entityId: '12' })
    expect(entityFromPath('/api/admin/evotor/stores/abc/sync')).toEqual({ entity: 'evotor_store', entityId: 'abc' })
    expect(entityFromPath('/api/admin/products/bulk')).toEqual({ entity: 'products', entityId: null })
  })
})

describe('admin console API', () => {
  const S1 = 'aaaaaaaa-1111-1111-1111-111111111111'
  const S2 = 'bbbbbbbb-2222-2222-2222-222222222222'
  const now = Date.now()
  const ids = { u1: 0, u2: 0, p1: 0, p2: 0 }

  it('requires the admin token', async () => {
    expect((await app.request('/api/admin/dashboard')).status).toBe(403)
    expect((await app.request('/api/admin/dashboard', { headers: { 'X-Admin-Token': 'test-admin-x' } })).status).toBe(403)
    expect((await get('/dashboard')).status).toBe(200)
  })

  it('seeds stores, customers, documents and products', async () => {
    const cols = db.prepare(`PRAGMA table_info(evotor_stores)`).all() as { name: string }[]
    if (!cols.some((c) => c.name === 'sync_enabled')) db.exec(`ALTER TABLE evotor_stores ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 0`)
    db.prepare(`INSERT INTO evotor_stores(store_uuid,name,sync_enabled,updated_at) VALUES(?,?,1,?),(?,?,0,?)`).run(S1, 'Точка 1', now, S2, 'Точка 2', now)
    db.prepare(`INSERT INTO evotor_sync_state(store_uuid,last_seen_close_ms,last_fast_at,status) VALUES(?,?,?,'OK')`).run(S1, now, now - 2 * 60_000)

    for (const [n, code, cid] of [['Аня', '101', 'cid-101'], ['Борис', '202', 'cid-202']] as const) {
      const r = await app.request('/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      expect(r.status).toBe(200)
      const u = db.prepare('SELECT id FROM users ORDER BY id DESC LIMIT 1').get() as { id: number }
      db.prepare('UPDATE users SET nickname=?, card_code=?, card_id=? WHERE id=?').run(n, code, cid, u.id)
      db.prepare('INSERT OR REPLACE INTO cards(user_id,paid_total,free_used,seq,updated_at) VALUES(?,?,?,?,?)').run(u.id, n === 'Аня' ? 3 : 1, 0, 0, now)
      if (n === 'Аня') ids.u1 = u.id; else ids.u2 = u.id
    }
    db.prepare('UPDATE users SET invited_by=? WHERE id=?').run(ids.u1, ids.u2)

    const doc = db.prepare(`INSERT INTO evotor_docs(store_uuid,doc_id,type,number,close_date_ms,source,status,attempts,last_error,received_at,processed_at)
      VALUES(?,?,?,?,?,'poll',?,?,?,?,?)`)
    const op = db.prepare(`INSERT INTO loyalty_ops(doc_store,doc_id,kind,card_id,cups_counted,free,cb,result_rub,created_at) VALUES(?,?,'SELL',?,?,?,?,?,?)`)
    for (let i = 1; i <= 5; i++) {
      doc.run(S1, 'doc-' + String(i).padStart(3, '0'), 'SELL', i, now - (10 - i) * 60_000, 'PROCESSED', 1, null, now - (10 - i) * 60_000, now)
      op.run(S1, 'doc-' + String(i).padStart(3, '0'), 'cid-101', i === 5 ? 0 : 1, 0, 0, 150, now - (10 - i) * 60_000)
    }
    doc.run(S1, 'doc-fail', 'SELL', 9, now - 30_000, 'FAILED', 3, 'boom', now - 30_000, null)
    doc.run(S1, 'doc-nocard', 'SELL', 10, now - 20_000, 'PROCESSED', 1, null, now - 20_000, now)
    doc.run(S1, 'doc-session', 'OPEN_SESSION', 11, now - 10_000, 'IGNORED', 1, null, now - 10_000, now)

    for (const [name, price] of [['Капучино', 200], ['Булка', 100]] as const) {
      const r = await json(await send('POST', '/products', { name, price }))
      expect(r.ok).toBe(true)
      if (name === 'Капучино') ids.p1 = r.id; else ids.p2 = r.id
    }
  })

  it('dashboard summarises documents, operations and till health', async () => {
    const d = await json(await get('/dashboard?period=24h'))
    expect(d.docs.sell).toBe(7)
    expect(d.docs.sellFailed).toBe(1)
    expect(d.ops.sells).toBe(5)
    expect(d.ops.cups).toBe(4)
    expect(d.sellWithoutCard).toBe(1)
    expect(d.customers).toBe(2)
    expect(d.health.level).toBe('ok')
    expect(d.health.stores.find((s: any) => s.uuid === S2).level).toBe('off')
    expect(d.recent.length).toBeLessThanOrEqual(10)
    const h = await json(await get('/evotor/health'))
    expect(h.thresholds).toEqual({ warnMin: 5, critMin: 30 })
  })

  it('operations: views, hidden ignored docs, cursor pagination', async () => {
    const all = await json(await get('/operations?limit=100'))
    expect(all.ops.map((o: any) => o.docId)).not.toContain('doc-session')
    expect(all.ops[0].docId).toBe('doc-nocard') // newest first
    const errors = await json(await get('/operations?view=errors'))
    expect(errors.ops.map((o: any) => o.docId)).toEqual(['doc-fail'])
    expect(errors.ops[0].lastError).toBe('boom')
    const credited = await json(await get('/operations?view=credited&limit=100'))
    expect(credited.ops).toHaveLength(5)
    expect(credited.ops[0].cardCode).toBe('101')
    const nocard = await json(await get('/operations?view=nocard'))
    expect(nocard.ops.map((o: any) => o.docId)).toEqual(['doc-nocard'])

    const p1 = await json(await get('/operations?view=credited&limit=2'))
    expect(p1.ops).toHaveLength(2)
    expect(p1.next).toBeTruthy()
    const p2 = await json(await get('/operations?view=credited&limit=2&cursor=' + p1.next))
    const p3 = await json(await get('/operations?view=credited&limit=2&cursor=' + p2.next))
    const seen = [...p1.ops, ...p2.ops, ...p3.ops].map((o: any) => o.docId)
    expect(new Set(seen).size).toBe(5)
    expect(p3.next).toBeNull()

    const byCard = await json(await get('/operations?q=101'))
    expect(byCard.ops.every((o: any) => o.cardCode === '101')).toBe(true)
    const detail = await json(await get(`/operations/${S1}/doc-fail`))
    expect(detail.op.status).toBe('FAILED')
    expect((await get(`/operations/${S1}/nope`)).status).toBe(404)
  })

  it('operations.csv is a spreadsheet-friendly file', async () => {
    const r = await get('/operations.csv?view=errors')
    expect(r.headers.get('content-type')).toContain('text/csv')
    const bytes = new Uint8Array(await r.clone().arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 BOM for Excel
    expect(await r.text()).toContain('boom')
  })

  it('customers: search by card code or nickname, sort, no phone leaked', async () => {
    const byCode = await json(await get('/customers?q=202'))
    expect(byCode.customers.map((c: any) => c.nickname)).toEqual(['Борис'])
    const byNick = await json(await get('/customers?q=%D0%90%D0%BD'))
    expect(byNick.customers[0].nickname).toBe('Аня')
    const sorted = await json(await get('/customers?sort=paid&dir=desc'))
    expect(sorted.customers[0].nickname).toBe('Аня')
    expect(sorted.customers[0].cups).toBe(4)
    expect(sorted.customers[0].referrals).toBe(1)
    expect(JSON.stringify(sorted)).not.toContain('guest:')
    expect(JSON.stringify(sorted)).not.toContain('phone')
  })

  it('customer card: operations, referrals, hints; phone only on explicit request', async () => {
    const c = await json(await get('/customers/' + ids.u1))
    expect(c.user.cardCode).toBe('101')
    expect(c.user.paidTotal).toBe(3)
    expect(c.ops).toHaveLength(5)
    expect(c.referrals.map((r: any) => r.nickname)).toEqual(['Борис'])
    expect(c.hasPhone).toBe(false)
    expect(JSON.stringify(c)).not.toContain('guest:')
    expect(c.hints.join(' ')).toContain('без начисленных чашек')
    const b = await json(await get('/customers/' + ids.u2))
    expect(b.invitedBy.nickname).toBe('Аня')
    expect(b.hints.join(' ')).toContain('нет ни одной операции')
    expect((await json(await get(`/customers/${ids.u1}/phone`))).phone).toBeNull()
    expect((await get('/customers/99999')).status).toBe(404)
  })

  it('vouchers: templates list, preview and a grant to one customer (audited)', async () => {
    db.prepare(`INSERT OR IGNORE INTO voucher_templates(code,title,kind,value,valid_days) VALUES('gift10','Подарок 10%','percent',10,14)`).run()
    expect((await json(await get('/voucher-templates'))).templates.some((t: any) => t.code === 'gift10')).toBe(true)
    expect((await json(await get('/vouchers/grant-all/preview?code=gift10'))).users).toBe(2)
    expect((await get('/vouchers/grant-all/preview?code=nope')).status).toBe(404)
    expect((await send('POST', `/customers/${ids.u2}/vouchers`, { code: 'nope' })).status).toBe(404)
    expect((await send('POST', `/customers/${ids.u2}/vouchers`, { code: 'gift10' })).status).toBe(200)
    const c = await json(await get('/customers/' + ids.u2))
    expect(c.vouchers.map((v: any) => v.title)).toContain('Подарок 10%')
  })

  it('PATCH /products/:id changes only what was sent, queues sync, refuses stale edits', async () => {
    const before = db.prepare('SELECT name, price, available, updated_at FROM products WHERE id=?').get(ids.p1) as any
    const r = await json(await send('PATCH', '/products/' + ids.p1, { price: 230, expectedUpdatedAt: before.updated_at }))
    expect(r.changed).toBe(1)
    const after = db.prepare('SELECT name, price, available, updated_at FROM products WHERE id=?').get(ids.p1) as any
    expect(after.price).toBe(230)
    expect(after.name).toBe(before.name)
    expect(after.available).toBe(before.available)
    const q = db.prepare(`SELECT COUNT(*) AS n FROM evotor_outbox WHERE store_uuid=? AND entity='PRODUCT' AND entity_key=? AND status='PENDING'`).get(S1, String(ids.p1)) as { n: number }
    expect(q.n).toBe(1)
    const none = db.prepare(`SELECT COUNT(*) AS n FROM evotor_outbox WHERE store_uuid=?`).get(S2) as { n: number }
    expect(none.n).toBe(0) // stores without sync_enabled get nothing
    // stale expectedUpdatedAt → 409, nothing changes
    const stale = await send('PATCH', '/products/' + ids.p1, { price: 999, expectedUpdatedAt: before.updated_at - 1 })
    expect(stale.status).toBe(409)
    expect((db.prepare('SELECT price FROM products WHERE id=?').get(ids.p1) as any).price).toBe(230)
    // no-op patch
    expect((await json(await send('PATCH', '/products/' + ids.p1, { price: 230 }))).changed).toBe(0)
    expect((await send('PATCH', '/products/' + ids.p1, { price: 1, priceDelta: 5 })).status).toBe(400)
    expect((await send('PATCH', '/products/99999', { price: 1 })).status).toBe(404)
  })

  it('bulk: dry run writes nothing, real run applies and is atomic about unknown ids', async () => {
    const dry = await json(await send('POST', '/products/bulk', { ids: [ids.p1, ids.p2], patch: { pricePercent: 10 }, dryRun: true }))
    expect(dry.changedProducts).toBe(2)
    expect(dry.plan.find((x: any) => x.id === ids.p2).changes[0]).toEqual({ field: 'price', from: 100, to: 110 })
    expect((db.prepare('SELECT price FROM products WHERE id=?').get(ids.p2) as any).price).toBe(100)

    const missing = await send('POST', '/products/bulk', { ids: [ids.p2, 99999], patch: { available: false } })
    expect(missing.status).toBe(404)
    expect((db.prepare('SELECT available FROM products WHERE id=?').get(ids.p2) as any).available).toBe(1)

    const real = await json(await send('POST', '/products/bulk', { ids: [ids.p1, ids.p2], patch: { available: false, priceDelta: 5 } }))
    expect(real.changedProducts).toBe(2)
    const rows = db.prepare('SELECT id, price, available FROM products WHERE id IN (?,?) ORDER BY id').all(ids.p1, ids.p2) as any[]
    expect(rows).toEqual([{ id: ids.p1, price: 235, available: 0 }, { id: ids.p2, price: 105, available: 0 }])

    const stores = await json(await send('POST', '/products/bulk', { ids: [ids.p1], stores: { enable: [S1] } }))
    expect(stores.ok).toBe(true)
    const link = db.prepare('SELECT enabled FROM product_store_links WHERE product_id=? AND store_uuid=?').get(ids.p1, S1) as any
    expect(link.enabled).toBe(1)
    expect((await send('POST', '/products/bulk', { ids: [ids.p1], stores: { enable: ['nope'] } })).status).toBe(404)
    expect((await send('POST', '/products/bulk', { ids: [ids.p1] })).status).toBe(400)
  })

  it('products.csv lists the menu', async () => {
    const t = await (await get('/products.csv')).text()
    expect(t).toContain('Капучино')
    expect(t.split('\r\n')[0]).toContain('Название')
  })

  it('audit journal records changes, hides secrets, filters by entity', async () => {
    const a = await json(await get('/audit?entity=products&limit=100'))
    expect(a.entries.length).toBeGreaterThanOrEqual(4)
    const patch = a.entries.find((e: any) => e.method === 'PATCH' && e.ok === 1 && e.before)
    expect(JSON.parse(patch.before)).toEqual({ price: 200 })
    expect(JSON.parse(patch.after)).toEqual({ price: 230 })
    const refused = a.entries.find((e: any) => e.status === 409)
    expect(refused.ok).toBe(0)
    const v = await json(await get('/audit?entity=customers'))
    expect(v.entries[0].summary).toContain('Выдан ваучер')
    expect(JSON.stringify(a)).not.toContain('test-admin')
    const errs = await json(await get('/audit?onlyErrors=1'))
    expect(errs.entries.every((e: any) => e.ok === 0)).toBe(true)
  })

  it('reset is refused when ADMIN_ALLOW_RESET=0', async () => {
    const r = await send('POST', '/reset', { mode: 'loyalty', confirm: true })
    expect(r.status).toBe(403)
    expect((db.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n).toBe(2)
  })
})
