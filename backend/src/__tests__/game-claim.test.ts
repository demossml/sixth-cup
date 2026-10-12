import { describe, expect, it, beforeAll } from 'vitest'
import { db } from '../db'
import { runMigrations } from '../db/migrate'

describe('game tables', () => {
  beforeAll(() => {
    runMigrations(db)
  })

  it('migration 014 creates game_sessions and game_daily', () => {
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(
      (r) => r.name,
    )
    expect(names).toContain('game_sessions')
    expect(names).toContain('game_daily')
  })
})
