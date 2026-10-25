import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-menu-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

// Dynamic import AFTER env (static import hoists above DB_PATH → would open the real DB)
const { app } = await import('../app')
const { db } = await import('../db')
const { ensureAddonsCategory } = await import('../modules/catalog/addonScheme')

const T = Date.now()
let seq = 0
const now = () => Date.now() + ++seq

const directory = async () => (await (await app.request('/api/directory')).json()) as any

function product(fields: {
  name: string
  price?: number
  categoryId?: number | null
  isGroup?: number
  icon?: string
  parentProductId?: number | null
}): number {
  const t = now()
  return Number(
    db
      .prepare(
        `INSERT INTO products(name, price, icon, available, sort_order, category_id,
                              created_at, updated_at, counts_as_cup, free_eligible,
                              is_group, parent_product_id)
         VALUES(?,?,?,1,0,?,?,?,0,0,?,?)`,
      )
      .run(
        fields.name,
        fields.price ?? 0,
        fields.icon ?? 'Coffee',
        fields.categoryId ?? null,
        t,
        t,
        fields.isGroup ?? 0,
        fields.parentProductId ?? null,
      ).lastInsertRowid,
  )
}

describe('PWA-меню: служебные сущности добавок не видны покупателю', () => {
  it('папки-группы добавок (is_group=1) не попадают в /api/directory', async () => {
    // Папки создаёт модель добавок; у них price=0, icon=Folder и category_id=NULL,
    // поэтому одного фильтра по категории недостаточно.
    const folder = product({ name: 'Сиропы-' + T, price: 0, icon: 'Folder', isGroup: 1 })
    const folder2 = product({ name: 'Молоко-' + T, price: 0, icon: 'Folder', isGroup: 1 })
    const drink = product({ name: 'Латте-' + T, price: 250 })

    const j = await directory()
    const ids = j.products.map((p: any) => p.id)

    expect(ids).toContain(drink)
    expect(ids).not.toContain(folder)
    expect(ids).not.toContain(folder2)
    expect(j.products.map((p: any) => p.name)).not.toContain('Сиропы-' + T)
  })

  it('товар категории «Добавки» не попадает в /api/directory', async () => {
    const cat = ensureAddonsCategory(db)
    const addon = product({ name: 'Овсяное-' + T, price: 40, categoryId: cat })
    const j = await directory()
    expect(j.products.map((p: any) => p.id)).not.toContain(addon)
    expect(j.categories.map((c: any) => c.name)).not.toContain('Добавки')
  })

  it('обычные позиции меню остаются на месте', async () => {
    const soup = product({ name: 'Суп-' + T, price: 180 })
    const j = await directory()
    expect(j.products.map((p: any) => p.id)).toContain(soup)
  })
})
