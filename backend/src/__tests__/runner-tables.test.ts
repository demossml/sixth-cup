import { describe, expect, it, beforeAll } from 'vitest'
import { db } from '../db'
import { runMigrations } from '../db/migrate'

describe('runner migration 015', () => {
  beforeAll(() => {
    runMigrations(db)
  })
  it('creates runner tables', () => {
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(
      (r) => r.name,
    )
    expect(names).toContain('runner_runs')
    expect(names).toContain('runner_progress')
  })
})
