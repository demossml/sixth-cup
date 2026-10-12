import { describe, expect, it, beforeAll } from 'vitest'
import { db } from '../db'
import { runMigrations } from '../db/migrate'

describe('device catalog data shape', () => {
  beforeAll(() => {
    runMigrations(db)
  })

  it('products table and links readable for catalog', () => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n
    expect(n).toBeGreaterThanOrEqual(0)
    // migration 013 availability table
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('product_store_availability')
  })
})
