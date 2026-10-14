import { describe, expect, it, beforeAll } from 'vitest'
import { db } from '../db'
import { runMigrations } from '../db/migrate'

describe('runner migrations 015–016', () => {
  beforeAll(() => {
    runMigrations(db)
  })
  it('creates runner tables', () => {
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(
      (r) => r.name,
    )
    expect(names).toContain('runner_runs')
    expect(names).toContain('runner_progress')
    const columns = (db.prepare('PRAGMA table_info(runner_progress)').all() as { name: string }[]).map(c => c.name)
    expect(columns).toContain('stars')
  })
})
