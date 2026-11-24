/**
 * F1: проверка переноса данных миграцией 062 на чистой БД.
 *
 * Живая dev-база пустая по cost_*, поэтому перенос проверяем изолированно: поднимаем
 * схему минимально, кладём старого вида ингредиент и рецепт, накатываем 062 и смотрим,
 * что получилось в tech_cards.
 */
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = join(__dirname, '..', 'db', 'migrations')
const sql = (file: string) => readFileSync(join(migrationsDir, file), 'utf8')

function scratch() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price INTEGER DEFAULT 0);
    CREATE TABLE stock_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, sku TEXT, kind TEXT NOT NULL DEFAULT 'raw', unit TEXT NOT NULL DEFAULT 'kg',
      min_qty REAL NOT NULL DEFAULT 0, multiplicity REAL NOT NULL DEFAULT 1, shelf_life_days INTEGER,
      default_supplier_id INTEGER, notes TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE purchase_invoices (
      id INTEGER PRIMARY KEY, status TEXT NOT NULL, posted_at INTEGER
    );
    CREATE TABLE purchase_invoice_lines (
      id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL, stock_item_id INTEGER NOT NULL
    );
  `)
  db.exec(sql('056_cost_techcards.sql'))
  return db
}

describe('F1: миграция 062 переносит справочник и рецепты', () => {
  it('ингредиент становится позицией склада, рецепт — техкартой с версией и строками', () => {
    const db = scratch()
    const t = 1_700_000_000_000
    // 900 ₽ за упаковку 1000 мл → 0,90 ₽ за мл = 90 копеек
    db.prepare(
      `INSERT INTO cost_ingredients(category_id, name, unit, pack_qty, pack_price_kop, comment, active, created_at, updated_at)
       VALUES(2,'Молоко 3,2%','ml',1000,90000,NULL,1,?,?)`,
    ).run(t, t)
    db.prepare(
      `INSERT INTO cost_recipes(name, output_label, product_id, markup_pct, retail_price_kop, method_text, status, created_at, updated_at)
       VALUES('Капучино','250 мл',NULL,300,25000,'взбить молоко','active',?,?)`,
    ).run(t, t)
    db.prepare(
      `INSERT INTO cost_recipe_lines(recipe_id, ingredient_id, qty, line_role, sort_order) VALUES(1,1,150,'base',0)`,
    ).run()

    db.exec(sql('062_cost_techcards_v2.sql'))
    db.exec(sql('077_cost_package_pricing.sql'))

    const item = db.prepare(
      `SELECT id, name, unit, manual_cost_kop AS cost, package_qty AS packageQty,
              package_price_kop AS packagePriceKop, price_mode AS priceMode FROM stock_items`,
    ).all() as {
      id: number
      name: string
      unit: string
      cost: number | null
      packageQty: number
      packagePriceKop: number
      priceMode: string
    }[]
    expect(item).toHaveLength(1)
    expect(item[0]).toMatchObject({
      name: 'Молоко 3,2%',
      unit: 'ml',
      cost: null,
      packageQty: 1000,
      packagePriceKop: 90000,
      priceMode: 'manual',
    })

    const card = db.prepare(`SELECT id, name, output_qty AS qty, status, retail_price_kop AS retail FROM tech_cards`).get() as {
      id: number
      name: string
      qty: number
      status: string
      retail: number
    }
    expect(card).toMatchObject({ id: 1, name: 'Капучино', qty: 1, status: 'active', retail: 25000 })

    const versions = db.prepare(`SELECT COUNT(*) AS n FROM tech_card_versions`).get() as { n: number }
    expect(versions.n).toBe(1)

    const line = db
      .prepare(
        `SELECT l.qty_brutto AS qty, i.name AS itemName, l.line_role AS role
           FROM tech_card_lines l JOIN stock_items i ON i.id = l.stock_item_id`,
      )
      .get() as { qty: number; itemName: string; role: string }
    expect(line).toEqual({ qty: 150, itemName: 'Молоко 3,2%', role: 'base' })

    const mapped = db
      .prepare(`SELECT cost_ingredient_id AS ci, stock_item_id AS si FROM cost_ingredient_map`)
      .get() as { ci: number; si: number }
    expect(mapped).toEqual({ ci: 1, si: item[0].id })

    const history = db.prepare(`SELECT source, cost_kop AS cost FROM stock_item_cost_history ORDER BY id DESC LIMIT 1`).get() as {
      source: string
      cost: number | null
    }
    expect(history).toEqual({ source: 'manual', cost: 90 })

    // Повторный прогон (migrations идемпотентны по данным) не дублирует карты.
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM tech_cards`).get() as { n: number }).n
    expect(before).toBe(1)
  })

  it('существующая позиция склада переиспользуется, а не дублируется', () => {
    const db = scratch()
    const t = 1_700_000_000_000
    db.prepare(
      `INSERT INTO stock_items(name, unit, created_at, updated_at) VALUES('Молоко 3,2%','ml',?,?)`,
    ).run(t, t)
    db.prepare(
      `INSERT INTO cost_ingredients(category_id, name, unit, pack_qty, pack_price_kop, comment, active, created_at, updated_at)
       VALUES(2,'Молоко 3,2%','ml',1000,90000,NULL,1,?,?)`,
    ).run(t, t)

    db.exec(sql('062_cost_techcards_v2.sql'))
    db.exec(sql('077_cost_package_pricing.sql'))

    const n = (db.prepare(`SELECT COUNT(*) AS n FROM stock_items`).get() as { n: number }).n
    expect(n).toBe(1)
    const mapped = db.prepare(`SELECT stock_item_id AS si FROM cost_ingredient_map`).get() as { si: number }
    expect(mapped.si).toBe(1)
    const item = db
      .prepare(`SELECT manual_cost_kop AS cost, package_qty AS qty, price_mode AS mode FROM stock_items`)
      .get() as { cost: number | null; qty: number | null; mode: string }
    expect(item).toEqual({ cost: null, qty: 1000, mode: 'manual' })
  })

  it('keeps a conflicting existing price and records the legacy package for review', () => {
    const db = scratch()
    const t = 1_700_000_000_000
    db.prepare(
      `INSERT INTO cost_ingredients(category_id, name, unit, pack_qty, pack_price_kop, comment, active, created_at, updated_at)
       VALUES(2,'Молоко 3,2%','ml',1000,90000,NULL,1,?,?)`,
    ).run(t, t)

    db.exec(sql('062_cost_techcards_v2.sql'))
    db.prepare(`UPDATE stock_items SET manual_cost_kop=120 WHERE name='Молоко 3,2%'`).run()
    db.exec(sql('077_cost_package_pricing.sql'))

    const item = db.prepare(
      `SELECT manual_cost_kop AS cost, package_qty AS qty, package_price_kop AS packPrice FROM stock_items`,
    ).get() as { cost: number | null; qty: number | null; packPrice: number | null }
    expect(item).toEqual({ cost: 120, qty: null, packPrice: null })
    const conflict = db.prepare(`SELECT reason FROM cost_price_migration_conflicts`).get() as { reason: string }
    expect(conflict.reason).toMatch(/отличается/)
  })
})
