/**
 * Предзаказ: активный заказ, один заказ, бан за невыкуп, ETA и авто-переходы,
 * UUID позиций для кассы, админ-страховка.
 *
 * Время не ждём: метки (accepted_at, eta_ready_at, expires_at) правим прямо в БД.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-preorder-life-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { ensureCard } = await import('../modules/loyalty/proof')
const { ensurePreorderTables } = await import('../modules/orders/service')

const H_ADMIN = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
const JSONH = { 'content-type': 'application/json' }

let seq = 0
const uniq = (p: string) => `${p}-${++seq}`

async function guest(): Promise<{ token: string; userId: number }> {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: JSONH, body: '{}' })
  const { token } = (await r.json()) as { token: string }
  const me = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  const j = (await me.json()) as { cardCode?: string }
  const row = db.prepare('SELECT id FROM users WHERE card_code=?').get(String(j.cardCode)) as { id: number }
  ensureCard(row.id)
  return { token, userId: Number(row.id) }
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

async function deviceToken(storeId: number): Promise<string> {
  const r = await app.request('/api/admin/devices', { method: 'POST', headers: H_ADMIN, body: JSON.stringify({ storeId, name: uniq('term') }) })
  const { enrollCode } = (await r.json()) as { enrollCode: string }
  const e = await app.request('/api/devices/enroll', { method: 'POST', headers: JSONH, body: JSON.stringify({ code: enrollCode }) })
  const { deviceToken: token } = (await e.json()) as { deviceToken: string }
  return token
}

async function createOrder(token: string, storeId: number, productId: number, qty = 1) {
  const r = await app.request('/api/orders', {
    method: 'POST',
    headers: { ...JSONH, ...auth(token) },
    body: JSON.stringify({ storeId, items: [{ productId: String(productId), quantity: qty }] }),
  })
  const body = (await r.json()) as Record<string, unknown>
  return { status: r.status, body }
}

const active = async (token: string) => {
  const r = await app.request('/api/orders/active', { headers: auth(token) })
  return { status: r.status, body: (await r.json()) as { ok: boolean; order: { id: string; status: string } | null; bannedUntil: string | null } }
}

const STORE = 1
const PRODUCT = 950
const EVOTOR_UUID = 'evo-uuid-950'
const EVOTOR_STORE_UUID = 'evotor-store-1'

beforeEach(() => {
  ensurePreorderTables(db as never)
  // настройки — общие для БД, поэтому каждый тест начинает с дефолтов
  db.prepare(`DELETE FROM app_settings WHERE key LIKE 'preorder%'`).run()
  db.prepare(`DELETE FROM preorder_bans`).run()
  const t = Date.now()
  db.prepare(`INSERT OR REPLACE INTO stores(id,name,address) VALUES(?,?,?)`).run(STORE, 'Тестовая', 'ул. Тест, 1')
  db.prepare(`INSERT OR REPLACE INTO stores(id,name,address) VALUES(?,?,?)`).run(2, 'Вторая', 'ул. 2')
  db.prepare(`INSERT OR REPLACE INTO evotor_stores(store_uuid,name,local_store_id,updated_at) VALUES(?,?,?,?)`)
    .run(EVOTOR_STORE_UUID, 'Тестовая (Эвотор)', STORE, t)
  db.prepare(
    `INSERT OR REPLACE INTO products(id,name,price,available,icon,counts_as_cup,recipe_seconds,sort_order,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(PRODUCT, 'Капучино 300', 260, 1, 'Coffee', 1, 120, 1, t, t)
  db.prepare(
    `INSERT OR REPLACE INTO product_store_links(product_id,store_uuid,evotor_uuid,enabled,updated_at) VALUES(?,?,?,?,?)`,
  ).run(PRODUCT, EVOTOR_STORE_UUID, EVOTOR_UUID, 1, t)
})

describe('A: ETA и авто-переходы', () => {
  it('нет ETA в draft, появляется при «принят» и учитывается в остатке', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const { status, body } = await createOrder(g.token, STORE, PRODUCT)
    expect(status).toBe(200)
    const order = body.order as { id: string; etaReadyAt: string | null; etaMinutes: number | null }
    expect(order.etaReadyAt).toBeNull()

    const acc = await app.request(`/api/devices/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { ...JSONH, 'X-Device-Token': dev },
      body: JSON.stringify({ status: 'accepted' }),
    })
    expect(acc.status).toBe(200)
    const accepted = ((await acc.json()) as { order: { etaReadyAt: string; etaMinutes: number; status: string } }).order
    expect(accepted.status).toBe('accepted')
    expect(accepted.etaReadyAt).toBeTruthy()
    expect(accepted.etaMinutes).toBeGreaterThanOrEqual(2) // 120 с рецепта → минимум 2 минуты
  })

  it('accepted → cooking по таймеру, cooking → ready по ETA (auto)', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id
    await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'accepted' }),
    })

    // сдвигаем «принят» в прошлое — авто-переход в cooking
    db.prepare(`UPDATE preorders SET accepted_at=?, eta_ready_at=? WHERE id=?`)
      .run(Math.floor(Date.now() / 1000) - 120, Math.floor(Date.now() / 1000) + 3600, id)
    let a = await active(g.token)
    expect(a.body.order?.status).toBe('cooking')

    // ETA в прошлом — авто-переход в ready
    db.prepare(`UPDATE preorders SET eta_ready_at=? WHERE id=?`).run(Math.floor(Date.now() / 1000) - 5, id)
    a = await active(g.token)
    expect(a.body.order?.status).toBe('ready')
    const row = db.prepare('SELECT ready_by FROM preorders WHERE id=?').get(id) as { ready_by: string }
    expect(row.ready_by).toBe('auto')
  })

  it('autoReady=false отключает авто-«готов», кассир подтверждает сам', async () => {
    await app.request('/api/admin/preorder/settings', {
      method: 'PATCH', headers: H_ADMIN, body: JSON.stringify({ storeId: STORE, autoReady: false, prepMinutes: 5 }),
    })
    const g = await guest()
    const dev = await deviceToken(STORE)
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id
    await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'accepted' }),
    })
    db.prepare(`UPDATE preorders SET accepted_at=?, eta_ready_at=? WHERE id=?`)
      .run(Math.floor(Date.now() / 1000) - 120, Math.floor(Date.now() / 1000) - 60, id)
    const a = await active(g.token)
    expect(a.body.order?.status).toBe('cooking')

    const ready = await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'ready' }),
    })
    expect(ready.status).toBe(200)
    const row = db.prepare('SELECT ready_by FROM preorders WHERE id=?').get(id) as { ready_by: string }
    expect(row.ready_by).toBe('cashier')
  })

  it('кассир подтверждает «готов» раньше ETA (accepted → ready)', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id
    await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'accepted' }),
    })
    // ETA ещё в будущем — «готов» приходит от кассира, а не от таймера
    const ready = await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'ready' }),
    })
    expect(ready.status).toBe(200)
    const order = ((await ready.json()) as { order: { status: string } }).order
    expect(order.status).toBe('ready')
    const row = db.prepare('SELECT ready_by FROM preorders WHERE id=?').get(id) as { ready_by: string }
    expect(row.ready_by).toBe('cashier')
  })

  it('кассир уточняет ETA через /devices/orders/:id/eta', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id
    await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'accepted' }),
    })
    const r = await app.request(`/api/devices/orders/${id}/eta`, {
      method: 'POST', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ etaMinutes: 3 }),
    })
    expect(r.status).toBe(200)
    const order = ((await r.json()) as { order: { etaMinutes: number } }).order
    expect(order.etaMinutes).toBeLessThanOrEqual(3)
    expect(order.etaMinutes).toBeGreaterThanOrEqual(2)
  })
})

describe('B: активный заказ, один заказ, бан', () => {
  it('без JWT заказ не создаётся', async () => {
    const r = await app.request('/api/orders', {
      method: 'POST', headers: JSONH, body: JSON.stringify({ storeId: STORE, items: [{ productId: String(PRODUCT), quantity: 1 }] }),
    })
    expect(r.status).toBe(401)
  })

  it('active: нет заказа → null, после create → draft, второй заказ → 409', async () => {
    const g = await guest()
    let a = await active(g.token)
    expect(a.body.order).toBeNull()

    const first = await createOrder(g.token, STORE, PRODUCT)
    expect(first.status).toBe(200)
    const firstId = (first.body.order as { id: string }).id
    a = await active(g.token)
    expect(a.body.order?.id).toBe(firstId)
    expect(a.body.order?.status).toBe('draft')

    const second = await createOrder(g.token, STORE, PRODUCT)
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('active_order_exists')
    expect(second.body.activeOrderId).toBe(firstId)
  })

  it('отмена черновика освобождает место для нового заказа', async () => {
    const g = await guest()
    const first = await createOrder(g.token, STORE, PRODUCT)
    const id = (first.body.order as { id: string }).id
    const cancel = await app.request(`/api/orders/${id}/cancel`, { method: 'POST', headers: { ...JSONH, ...auth(g.token) }, body: '{}' })
    expect(cancel.status).toBe(200)
    expect((await active(g.token)).body.order).toBeNull()
    expect((await createOrder(g.token, STORE, PRODUCT)).status).toBe(200)
  })

  it('P1-4: заказ без guest_user_id не читается и не отменяется гостем', async () => {
    const g = await guest()
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id
    // Заказ, созданный кассой/админом: владельца нет.
    db.prepare('UPDATE preorders SET guest_user_id=NULL WHERE id=?').run(id)

    const read = await app.request(`/api/orders/${id}`, { headers: auth(g.token) })
    expect(read.status).toBe(404)

    const cancel = await app.request(`/api/orders/${id}/cancel`, {
      method: 'POST', headers: { ...JSONH, ...auth(g.token) }, body: '{}',
    })
    expect([400, 404]).toContain(cancel.status)

    const received = await app.request(`/api/orders/${id}/received`, {
      method: 'POST', headers: { ...JSONH, ...auth(g.token) }, body: '{}',
    })
    expect([404, 409]).toContain(received.status)
  })

  it('чужой заказ не читается', async () => {
    const owner = await guest()
    const stranger = await guest()
    const { body } = await createOrder(owner.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id
    const r = await app.request(`/api/orders/${id}`, { headers: auth(stranger.token) })
    expect(r.status).toBe(404)
  })

  it('невыкуп принятого заказа → бан; create → 403; админ снимает бан → create снова работает', async () => {
    await app.request('/api/admin/preorder/settings', {
      method: 'PATCH', headers: H_ADMIN, body: JSON.stringify({ storeId: STORE, noShowBanHours: 48 }),
    })
    const g = await guest()
    const dev = await deviceToken(STORE)
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id
    // Касса приняла заказ — только тогда истечение считается невыкупом (P0-5).
    const acc = await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'accepted' }),
    })
    expect(acc.status).toBe(200)
    // TTL истёк, заказ не оплачен
    db.prepare('UPDATE preorders SET expires_at=? WHERE id=?').run(Math.floor(Date.now() / 1000) - 60, id)

    const a = await active(g.token)
    expect(a.body.order).toBeNull()
    expect(a.body.bannedUntil).toBeTruthy()
    const row = db.prepare('SELECT status FROM preorders WHERE id=?').get(id) as { status: string }
    expect(row.status).toBe('expired')

    const blocked = await createOrder(g.token, STORE, PRODUCT)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error).toBe('preorder_banned')
    expect(blocked.body.bannedUntil).toBeTruthy()

    const lift = await app.request(`/api/admin/preorder/bans/${g.userId}/lift`, { method: 'POST', headers: H_ADMIN })
    expect(lift.status).toBe(200)
    expect((await createOrder(g.token, STORE, PRODUCT)).status).toBe(200)
  })

  it('draft истёк без принятия кассой → бана нет (P0-5)', async () => {
    const g = await guest()
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id
    db.prepare('UPDATE preorders SET expires_at=? WHERE id=?').run(Math.floor(Date.now() / 1000) - 60, id)

    const a = await active(g.token)
    expect(a.body.order).toBeNull()
    expect(a.body.bannedUntil).toBeNull()

    const row = db.prepare('SELECT status FROM preorders WHERE id=?').get(id) as { status: string }
    expect(row.status).toBe('expired')
    const bans = db.prepare('SELECT COUNT(*) AS n FROM preorder_bans WHERE user_id=?').get(g.userId) as { n: number }
    expect(bans.n).toBe(0)

    // Новый заказ доступен сразу: гость не спамил, его заказ касса даже не увидела.
    expect((await createOrder(g.token, STORE, PRODUCT)).status).toBe(200)
  })

  it('бан истекает сам', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id
    await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'accepted' }),
    })
    db.prepare('UPDATE preorders SET expires_at=? WHERE id=?').run(Math.floor(Date.now() / 1000) - 60, id)
    await active(g.token) // фиксируем бан
    db.prepare('UPDATE preorder_bans SET until=? WHERE user_id=?').run(Math.floor(Date.now() / 1000) - 1, g.userId)
    expect((await createOrder(g.token, STORE, PRODUCT)).status).toBe(200)
  })

  it('P0-6: mark-paid идемпотентен и не закрывает отменённый заказ', async () => {
    const dev = await deviceToken(STORE)
    const g = await guest()
    const first = await createOrder(g.token, STORE, PRODUCT)
    const id = (first.body.order as { id: string }).id
    await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'accepted' }),
    })
    await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'ready' }),
    })
    const paid1 = await app.request(`/api/devices/orders/${id}/mark-paid`, {
      method: 'POST', headers: { ...JSONH, 'X-Device-Token': dev },
      body: JSON.stringify({ amountRub: 260, fiscalDocumentNumber: 'FD-1' }),
    })
    expect(paid1.status).toBe(200)
    // Повтор — тот же результат, без ошибки.
    const paid2 = await app.request(`/api/devices/orders/${id}/mark-paid`, {
      method: 'POST', headers: { ...JSONH, 'X-Device-Token': dev }, body: '{}',
    })
    expect(paid2.status).toBe(200)
    expect(((await paid2.json()) as any).order.status).toBe('paid')

    // Отменённый заказ оплатить нельзя.
    const g2 = await guest()
    const second = await createOrder(g2.token, STORE, PRODUCT)
    const id2 = (second.body.order as { id: string }).id
    await app.request(`/api/orders/${id2}/cancel`, { method: 'POST', headers: { ...JSONH, ...auth(g2.token) }, body: '{}' })
    const paidCancelled = await app.request(`/api/devices/orders/${id2}/mark-paid`, {
      method: 'POST', headers: { ...JSONH, 'X-Device-Token': dev }, body: '{}',
    })
    expect(paidCancelled.status).toBe(409)
  })

  it('P0-6: расхождение суммы и чужой фискальный номер — отказ', async () => {
    const dev = await deviceToken(STORE)
    const g = await guest()
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id
    await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'accepted' }),
    })

    const wrong = await app.request(`/api/devices/orders/${id}/mark-paid`, {
      method: 'POST', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ amountRub: 1 }),
    })
    expect(wrong.status).toBe(409)
    expect(((await wrong.json()) as any).error).toBe('amount_mismatch')

    db.prepare(`INSERT OR REPLACE INTO preorders(id, short_code, store_id, status, estimate_total, currency, expires_at, created_at, updated_at, fiscal_document_number)
      VALUES('other-fiscal','999999',?, 'ready', 260, 'RUB', ?, ?, ?, 'FD-DUP')`)
      .run(STORE, Math.floor(Date.now() / 1000) + 600, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))
    const dup = await app.request(`/api/devices/orders/${id}/mark-paid`, {
      method: 'POST', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ fiscalDocumentNumber: 'FD-DUP' }),
    })
    expect(dup.status).toBe(409)
    expect(((await dup.json()) as any).error).toBe('duplicate_fiscal')
  })

  it('оплаченный заказ остаётся активным до «Я забрал»', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id
    await app.request(`/api/devices/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSONH, 'X-Device-Token': dev }, body: JSON.stringify({ status: 'accepted' }),
    })
    const paid = await app.request(`/api/devices/orders/${id}/mark-paid`, { method: 'POST', headers: { 'X-Device-Token': dev } })
    expect(paid.status).toBe(200)
    expect((await active(g.token)).body.order?.status).toBe('paid')

    const received = await app.request(`/api/orders/${id}/received`, { method: 'POST', headers: { ...JSONH, ...auth(g.token) }, body: '{}' })
    expect(received.status).toBe(200)
    expect((await active(g.token)).body.order).toBeNull()
  })
})

describe('C: данные для кассы', () => {
  it('UUID позиции резолвится по точке, чужой заказ не резолвится', async () => {
    const g = await guest()
    const dev = await deviceToken(STORE)
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const order = body.order as { id: string; shortCode: string; items: { evotorProductUuid: string | null }[] }
    expect(order.items[0].evotorProductUuid).toBe(EVOTOR_UUID)

    const ok = await app.request(`/api/devices/orders/resolve?code=${order.shortCode}`, { headers: { 'X-Device-Token': dev } })
    expect(ok.status).toBe(200)

    const other = await deviceToken(2)
    // по коду поиск ограничен точкой устройства → просто «не найдено»
    const wrongCode = await app.request(`/api/devices/orders/resolve?code=${order.shortCode}`, { headers: { 'X-Device-Token': other } })
    expect(wrongCode.status).toBe(404)
    // по oid заказ найден, но принадлежит другой точке → 403
    const wrongOid = await app.request(`/api/devices/orders/resolve?oid=${order.id}`, { headers: { 'X-Device-Token': other } })
    expect(wrongOid.status).toBe(403)
  })

  it('без связи на точке UUID = null, заказ всё равно создаётся', async () => {
    db.prepare('DELETE FROM product_store_links WHERE product_id=?').run(PRODUCT)
    const g = await guest()
    const { status, body } = await createOrder(g.token, STORE, PRODUCT)
    expect(status).toBe(200)
    expect((body.order as { items: { evotorProductUuid: string | null }[] }).items[0].evotorProductUuid).toBeNull()
  })

  it('админ-страховка: список заказов и смена статуса с валидацией переходов', async () => {
    const g = await guest()
    const { body } = await createOrder(g.token, STORE, PRODUCT)
    const id = (body.order as { id: string }).id

    const list = await app.request(`/api/admin/preorder/orders?storeId=${STORE}`, { headers: H_ADMIN })
    expect(list.status).toBe(200)
    const listed = ((await list.json()) as { orders: { id: string; items: unknown[] }[] }).orders
    expect(listed.some((o) => o.id === id)).toBe(true)
    expect(listed.find((o) => o.id === id)?.items.length).toBe(1)

    const bad = await app.request(`/api/admin/preorder/orders/${id}/status`, {
      method: 'POST', headers: H_ADMIN, body: JSON.stringify({ status: 'ready' }),
    })
    expect(bad.status).toBe(409)

    const ok = await app.request(`/api/admin/preorder/orders/${id}/status`, {
      method: 'POST', headers: H_ADMIN, body: JSON.stringify({ status: 'accepted' }),
    })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { order: { status: string } }).order.status).toBe('accepted')
  })

  it('настройки точки читаются и влияют на ETA', async () => {
    const saved = await app.request('/api/admin/preorder/settings', {
      method: 'PATCH', headers: H_ADMIN, body: JSON.stringify({ storeId: STORE, prepMinutes: 12, noShowBanHours: 6 }),
    })
    expect(saved.status).toBe(200)
    const read = await app.request(`/api/admin/preorder/settings?storeId=${STORE}`, { headers: H_ADMIN })
    const j = (await read.json()) as { prepMinutes: number; noShowBanHours: number; autoReady: boolean; own: boolean }
    expect(j).toMatchObject({ prepMinutes: 12, noShowBanHours: 6, autoReady: true, own: true })
  })
})
