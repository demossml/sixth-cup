import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-addon-maxcount-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

// Dynamic import AFTER env, so the module opens the temp DB and not the working one.
const { db } = await import('../db')
const { ensureAddonSchemeSchema, replaceSchemeItems, defaultAddonMaxCount, normalizeAddonGroupKey } =
  await import('../modules/catalog/addonScheme')

function schemeId(): number {
  const t = Date.now()
  const r = db.prepare('INSERT INTO modifier_schemes(name, created_at, updated_at) VALUES(?,?,?)').run('M', t, t)
  return Number(r.lastInsertRowid)
}

function maxCounts(id: number): { group_key: string; max_count: number }[] {
  return db
    .prepare('SELECT group_key, max_count FROM modifier_scheme_items WHERE scheme_id=? ORDER BY id')
    .all(id) as { group_key: string; max_count: number }[]
}

describe('addon maxCount default', () => {
  it('keeps a single default per group: extra two, everything else one', () => {
    expect(defaultAddonMaxCount('extra')).toBe(2)
    expect(defaultAddonMaxCount('milk')).toBe(1)
    expect(defaultAddonMaxCount('syrup')).toBe(1)
    expect(defaultAddonMaxCount('sugar')).toBe(1)
  })

  it('legacy items writer used to give sugar a limit of two instead of one', () => {
    ensureAddonSchemeSchema(db)
    const id = schemeId()
    replaceSchemeItems(db, id, [
      { groupKey: 'sugar', productId: null, modifierId: null, zeroOption: true, nameOverride: 'Без сахара' },
      { groupKey: 'extra', productId: null, modifierId: null, zeroOption: true, nameOverride: 'Без добавки' },
    ])
    const rows = maxCounts(id)
    const sugar = rows.find((r) => r.group_key === 'sugar')
    const extra = rows.find((r) => r.group_key === 'extra')
    expect(sugar?.max_count).toBe(defaultAddonMaxCount('sugar'))
    expect(extra?.max_count).toBe(defaultAddonMaxCount('extra'))
  })

  it('explicit maxCount still wins over the default', () => {
    ensureAddonSchemeSchema(db)
    const id = schemeId()
    replaceSchemeItems(db, id, [
      { groupKey: 'sugar', productId: null, modifierId: null, zeroOption: true, maxCount: 3 },
    ])
    expect(maxCounts(id)[0].max_count).toBe(3)
  })

  it('unknown and russian group keys resolve to the same defaults as the catalog emits', () => {
    expect(normalizeAddonGroupKey('Сахар')).toBe('sugar')
    expect(normalizeAddonGroupKey('Другое')).toBe('extra')
    expect(defaultAddonMaxCount(normalizeAddonGroupKey('Другое'))).toBe(2)
  })
})
