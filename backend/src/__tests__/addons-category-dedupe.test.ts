import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-addoncat-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

// Dynamic import AFTER env (static import hoists above DB_PATH → would open the real DB)
const { app } = await import('../app')
const { db } = await import('../db')
const { dedupeCategoriesByName, resolveAddonsCategoryIds } = await import('../modules/catalog/addonScheme')

const T = Date.now()
let seq = 0

function makeCategory(name: string): number {
  const now = Date.now() + ++seq
  return Number(
    db
      .prepare('INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,1,?,?)')
      .run(name, 90, now, now).lastInsertRowid,
  )
}

function makeProduct(name: string, categoryId: number): number {
  const now = Date.now() + ++seq
  return Number(
    db
      .prepare(
        `INSERT INTO products(name, price, icon, available, sort_order, category_id, created_at, updated_at, counts_as_cup, free_eligible)
         VALUES(?,?,?,1,0,?,?,?,0,0)`,
      )
      .run(name, 30, 'Coffee', categoryId, now, now).lastInsertRowid,
  )
}

const directory = async () => (await (await app.request('/api/directory')).json()) as any

/** Bootstrap уже создаёт «Добавки» (миграция 027); для детерминизма начинаем с чистого листа. */
function clearAddonCategories() {
  for (const id of resolveAddonsCategoryIds(db)) {
    db.prepare('DELETE FROM products WHERE category_id=?').run(id)
    db.prepare('DELETE FROM categories WHERE id=?').run(id)
  }
}

describe('категория «Добавки»: дубли не попадают в меню клиента', () => {
  it('directory скрывает ВСЕ категории-добавки, а не только первую', async () => {
    clearAddonCategories()
    // Воспроизводим состояние старой БД: guard миграции 027 не складывает кириллицу,
    // поэтому рядом с уже существующей «Добавки» появляется вторая такая же.
    const first = makeCategory('Добавки')
    const second = makeCategory('Добавки')
    const pFirst = makeProduct('Сироп-дубль-1-' + T, first)
    const pSecond = makeProduct('Сироп-дубль-2-' + T, second)

    expect(resolveAddonsCategoryIds(db)).toEqual(expect.arrayContaining([first, second]))

    const j = await directory()
    expect(j.categories.map((c: any) => c.name)).not.toContain('Добавки')
    const ids = j.products.map((p: any) => p.id)
    expect(ids).not.toContain(pFirst)
    expect(ids).not.toContain(pSecond)

    // за собой убираем, чтобы не влиять на следующие тесты
    db.prepare('DELETE FROM products WHERE id IN (?,?)').run(pFirst, pSecond)
    db.prepare('DELETE FROM categories WHERE id IN (?,?)').run(first, second)
  })

  it('dedupeCategoriesByName схлопывает точные дубли и переносит товары, не теряя данные', async () => {
    clearAddonCategories()
    const keep = makeCategory('Добавки')
    const dup = makeCategory('Добавки')
    const prodInDup = makeProduct('Корица-дубль-' + T, dup)

    const collapsed = dedupeCategoriesByName(db)
    expect(collapsed).toBe(1)

    const rows = db.prepare("SELECT id FROM categories WHERE name='Добавки'").all() as { id: number }[]
    expect(rows).toHaveLength(1)
    const kept = rows[0].id
    expect([keep, dup]).toContain(kept)

    // товар не потерян, а перенесён в оставшуюся категорию
    const prod = db.prepare('SELECT category_id AS c FROM products WHERE id=?').get(prodInDup) as any
    expect(prod.c).toBe(kept)

    // повторный прогон идемпотентен
    expect(dedupeCategoriesByName(db)).toBe(0)

    db.prepare('DELETE FROM products WHERE id=?').run(prodInDup)
    db.prepare('DELETE FROM categories WHERE id=?').run(kept)
  })

  it('разные категории не склеиваются: «Добавки» и «Сиропы» остаются раздельно', async () => {
    clearAddonCategories()
    const addons = makeCategory('Добавки')
    const syrups = makeCategory('Сиропы')
    dedupeCategoriesByName(db)
    const left = db.prepare('SELECT id FROM categories WHERE id IN (?,?)').all(addons, syrups) as { id: number }[]
    expect(left).toHaveLength(2)
    db.prepare('DELETE FROM categories WHERE id IN (?,?)').run(addons, syrups)
  })
})
