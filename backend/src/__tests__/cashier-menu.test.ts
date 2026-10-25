/**
 * Меню кассы настраивается по каждой точке: app_settings.cashier_menu:<storeUuid>.
 * Порядок групп — свой у точки (или categories.sort_order), «Всё» и скрытые — тоже свои.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-cashier-menu-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const { runMigrations } = await import('../db/migrate')
const { app } = await import('../app')
const { getCashierMenu, hasStoreMenu } = await import('../lib/cashierMenu')

const A = 'store-a'
const B = 'store-b'

const admin = (method: string, path: string, body?: unknown) =>
  app.request(`/api/admin${path}`, {
    method,
    headers: { 'X-Admin-Token': 'test-admin', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const catalog = async (store: string) =>
  (await (await app.request(`/api/devices/catalog?storeUuid=${store}`)).json()) as any

const ins = (sql: string, ...a: unknown[]) => Number(db.prepare(sql).run(...a).lastInsertRowid)

function category(name: string, sortOrder: number): number {
  const t = Date.now()
  return ins(
    `INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,1,?,?)`,
    name,
    sortOrder,
    t,
    t,
  )
}

function product(name: string, categoryId: number): number {
  const t = Date.now()
  return ins(
    `INSERT INTO products(name, price, available, category_id, sort_order, created_at, updated_at) VALUES(?,?,1,?,0,?,?)`,
    name,
    100,
    categoryId,
    t,
    t,
  )
}

beforeAll(() => {
  runMigrations(db)
  db.prepare('DELETE FROM app_settings WHERE key LIKE ?').run('cashier_menu%')
  const coffee = category('Кофе', 2)
  const tea = category('Чай', 1)
  const food = category('Выпечка', 3)
  product('Капучино', coffee)
  product('Чай чёрный', tea)
  product('Круассан', food)
})

describe('per-store cashier menu', () => {
  it('starts with defaults: «Всё» включено, порядок из categories.sort_order', async () => {
    const j = await catalog(A)
    expect(j.menu.showAllTab).toBe(true)
    expect(j.menu.order).toEqual(['Чай', 'Кофе', 'Выпечка'])
    expect(j.menu.hidden).toEqual([])
    expect(hasStoreMenu(A)).toBe(false)
  })

  it('общая настройка сохраняется и наследуется точками без своей', async () => {
    const r = await admin('PATCH', '/cashier/menu', { showAllTab: false, hiddenGroups: ['Выпечка'] })
    expect(r.status).toBe(200)

    // точка без собственной настройки видит общую
    const own = (await (await admin('GET', `/cashier/menu?storeUuid=${A}`)).json()) as any
    expect(own.own).toBe(false)
    expect(own.showAllTab).toBe(false)
    expect(own.order).not.toContain('Выпечка')

    // и каталог отдаёт её же
    const cat = await catalog(A)
    expect(cat.menu.showAllTab).toBe(false)
    expect(cat.menu.hidden).toContain('Выпечка')

    // возвращаем общую к дефолту, чтобы не влиять на следующие тесты
    expect((await admin('PATCH', '/cashier/menu', { showAllTab: true, hiddenGroups: [] })).status).toBe(200)
  })

  it('settings of one store do not leak into another', async () => {
    const r = await admin('PATCH', '/cashier/menu', { storeUuid: A, showAllTab: false, hiddenGroups: ['Выпечка'] })
    expect(r.status).toBe(200)

    const a = await catalog(A)
    expect(a.menu.showAllTab).toBe(false)
    expect(a.menu.hidden).toEqual(['Выпечка'])
    expect(a.menu.order).toEqual(['Чай', 'Кофе'])

    const b = await catalog(B)
    expect(b.menu.showAllTab).toBe(true)
    expect(b.menu.hidden).toEqual([])
    expect(b.menu.order).toEqual(['Чай', 'Кофе', 'Выпечка'])

    expect(hasStoreMenu(A)).toBe(true)
    expect(hasStoreMenu(B)).toBe(false)
  })

  it('keeps a per-store order and appends groups missing from it', async () => {
    const r = await admin('PATCH', '/cashier/menu', { storeUuid: B, order: ['Кофе'] })
    expect(r.status).toBe(200)
    const j = await catalog(B)
    // «Кофе» поднят первым, остальные — в порядке sort_order
    expect(j.menu.order).toEqual(['Кофе', 'Чай', 'Выпечка'])
  })

  it('unknown group in order or hidden is rejected', async () => {
    expect((await admin('PATCH', '/cashier/menu', { storeUuid: A, order: ['Нет такой'] })).status).toBe(400)
    expect((await admin('PATCH', '/cashier/menu', { storeUuid: A, hiddenGroups: ['Нет такой'] })).status).toBe(400)
  })

  it('reads the store configuration back for the admin UI', async () => {
    const j = (await (await admin('GET', `/cashier/menu?storeUuid=${A}`)).json()) as any
    expect(j.storeUuid).toBe(A)
    expect(j.own).toBe(true)
    expect(j.showAllTab).toBe(false)
    expect(j.hiddenGroups).toEqual(['Выпечка'])
    // админка видит все группы (включая пустые и автосозданные), скрытая — только в allGroups
    expect(j.order.slice(0, 2)).toEqual(['Чай', 'Кофе'])
    expect(j.order).not.toContain('Выпечка')
    expect(j.allGroups).toContain('Выпечка')
  })

  it('legacy global setting still applies to stores without their own', async () => {
    db.prepare(`INSERT INTO app_settings(key, value, updated_at) VALUES('cashier_menu',?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify({ showAllTab: false }), Date.now())
    const c = await catalog('store-c')
    expect(c.menu.showAllTab).toBe(false)
    // у точки A своя настройка — она приоритетнее общей
    expect(getCashierMenu(A).hiddenGroups).toEqual(['Выпечка'])
    db.prepare(`DELETE FROM app_settings WHERE key='cashier_menu'`).run()
  })

  it('reset puts the store back on the shared defaults', async () => {
    const r = await admin('DELETE', `/cashier/menu?storeUuid=${A}`)
    expect(r.status).toBe(200)
    expect(hasStoreMenu(A)).toBe(false)
    const j = await catalog(A)
    expect(j.menu.showAllTab).toBe(true)
    expect(j.menu.hidden).toEqual([])
  })

  it('survives broken JSON in the settings row', () => {
    db.prepare(`INSERT INTO app_settings(key, value, updated_at) VALUES('cashier_menu:store-broken','{oops',?)
                ON CONFLICT(key) DO UPDATE SET value='{oops'`).run(Date.now())
    expect(getCashierMenu('store-broken')).toEqual({ showAllTab: true, hiddenGroups: [], order: [] })
  })
})
