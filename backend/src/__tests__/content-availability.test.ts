import { describe, expect, it, beforeAll } from 'vitest'
import { db } from '../db'
import { publicDirectory } from '../modules/directory/routes'
import { runMigrations } from '../db/migrate'

describe('content + availability', () => {
  beforeAll(() => {
    runMigrations(db)
  })

  it('draft promo is not in public content', () => {
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      INSERT INTO promos(title,body,icon,sponsor,starts_at,ends_at,status,placement,sort_order,kind)
      VALUES('Draft','x','Sparkles',NULL,?,?, 'draft','home',0,'promo')
    `).run(now - 10, now + 86400)
    db.prepare(`
      INSERT INTO promos(title,body,icon,sponsor,starts_at,ends_at,status,placement,sort_order,kind)
      VALUES('Live','y','Sparkles',NULL,?,?, 'published','home',0,'promo')
    `).run(now - 10, now + 86400)
    const dir = publicDirectory()
    const titles = (dir.content as { title: string }[]).map((c) => c.title)
    expect(titles).toContain('Live')
    expect(titles).not.toContain('Draft')
  })

  it('per-store availability overrides global', () => {
    const now = Date.now()
    const r = db.prepare(`
      INSERT INTO products(name,price,icon,available)
      VALUES('AvailTest',100,'Coffee',1)
    `).run()
    const id = Number(r.lastInsertRowid)
    db.prepare(`
      INSERT INTO product_store_availability(product_id,store_uuid,available,updated_at)
      VALUES(?,?,0,?)
    `).run(id, 'store-A', now)
    const open = publicDirectory(null)
    expect((open.products as { id: number }[]).some((p) => p.id === id)).toBe(true)
    const closed = publicDirectory('store-A')
    expect((closed.products as { id: number }[]).some((p) => p.id === id)).toBe(false)
  })
})
