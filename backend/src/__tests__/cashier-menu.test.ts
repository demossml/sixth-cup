/**
 * Настройка вкладок кассы: порядок групп берётся из categories.sort_order,
 * «Всё» и скрытые группы — из app_settings (админка → Касса).
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
const { getCashierMenu, setCashierMenu } = await import('../lib/cashierMenu')

const STORE = 'store-menu'
const admin = (method: string, path: string, body?: unknown) =>
  app.request(`/api/admin${path}`, {
    method,
    headers: { 'X-Admin-Token': 'test-admin', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const catalog = async () => (await (await app.request(`/api/devices/catalog?storeUuid=${STORE}`)).json()) as any

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

function product(name: string, categoryId: number, price = 100): number {
  const t = Date.now()
  return ins(
    `INSERT INTO products(name, price, available, category_id, sort_order, created_at, updated_at) VALUES(?,?,1,?,0,?,?)`,
    name,
    price,
    categoryId,
    t,
    t,
  )
}

beforeAll(() => {
  runMigrations(db)
  db.prepare('DELETE FROM app_settings WHERE key=?').run('cashier_menu')
  const coffee = category('Кофе', 2)
  const tea = category('Чай', 1)
  const food = category('Выпечка', 3)
  product('Капучино', coffee)
  product('Чай чёрный', tea)
  product('Круассан', food)
})

describe('cashier menu settings', () => {
  it('is enabled by default and keeps category sort order', async () => {
    expect(getCashierMenu()).toEqual({ showAllTab: true, hiddenGroups: [] })
    const j = await catalog()
    expect(j.menu.showAllTab).toBe(true)
    expect(j.menu.order).toEqual(['Чай', 'Кофе', 'Выпечка'])
    expect(j.menu.hidden).toEqual([])
    expect(j.categories.map((c: any) => c.name)).toEqual(['Чай', 'Кофе', 'Выпечка'])
  })

  it('turns the «Всё» tab off through the admin API', async () => {
    const r = await admin('PATCH', '/cashier/menu', { showAllTab: false })
    expect(r.status).toBe(200)
    const j = await catalog()
    expect(j.menu.showAllTab).toBe(false)
    // порядок групп не изменился
    expect(j.menu.order).toEqual(['Чай', 'Кофе', 'Выпечка'])
  })

  it('hides a group on the cashier but keeps its products out of the menu', async () => {
    expect((await admin('PATCH', '/cashier/menu', { hiddenGroups: ['Выпечка'] })).status).toBe(200)
    const j = await catalog()
    expect(j.menu.order).toEqual(['Чай', 'Кофе'])
    // касса должна знать имя скрытой группы, иначе дорисует чип в конце по алфавиту
    expect(j.menu.hidden).toEqual(['Выпечка'])
    expect(j.categories.map((c: any) => c.name)).toEqual(['Чай', 'Кофе'])
    // товар скрытой группы не должен светиться отдельной плиткой в списке категорий
    expect(j.products.some((p: any) => p.name === 'Круассан')).toBe(true)
  })

  it('rejects an unknown group instead of silently ignoring it', async () => {
    const r = await admin('PATCH', '/cashier/menu', { hiddenGroups: ['Нет такой'] })
    expect(r.status).toBe(400)
  })

  it('reads the settings back through the admin endpoint', async () => {
    const j = (await (await admin('GET', '/cashier/menu')).json()) as any
    expect(j.showAllTab).toBe(false)
    expect(j.hiddenGroups).toEqual(['Выпечка'])
    // порядок = categories.sort_order; «Добавки» создаётся автоматически и в каталог кассы не попадает
    expect(j.order.slice(0, 2)).toEqual(['Чай', 'Кофе'])
    expect(j.order).not.toContain('Выпечка')
  })

  it('survives broken JSON in the settings row', () => {
    db.prepare(`INSERT INTO app_settings(key, value, updated_at) VALUES('cashier_menu','{oops',?)
                ON CONFLICT(key) DO UPDATE SET value='{oops'`).run(Date.now())
    expect(getCashierMenu()).toEqual({ showAllTab: true, hiddenGroups: [] })
    setCashierMenu({ showAllTab: false })
    expect(getCashierMenu().showAllTab).toBe(false)
  })
})
