import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config'
import { SCHEMA } from './schema'
import { runMigrations } from './migrate'
import { migrateEvotorSchema } from '../integrations/evotor/db'

mkdirSync(dirname(config.dbPath), { recursive: true })
mkdirSync(config.uploadsDir, { recursive: true })

export const db = new Database(config.dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(SCHEMA)
runMigrations(db)
migrateEvotorSchema(db)

// card_code on users (short guest code; length grows with card count)
{
  const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'card_code')) {
    db.exec('ALTER TABLE users ADD COLUMN card_code TEXT')
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_card_code ON users(card_code) WHERE card_code IS NOT NULL",
    )
  }
}
