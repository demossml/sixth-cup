import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Sequential SQL migrations. Applied once, tracked in schema_migrations.
 * Base tables still created via SCHEMA (CREATE IF NOT EXISTS); migrations are additive.
 */
export function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)

  const dir = join(__dirname, 'migrations')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id)
  )

  for (const file of files) {
    const id = file.replace(/\.sql$/, '')
    if (applied.has(id)) continue
    const sql = readFileSync(join(dir, file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations(id, applied_at) VALUES(?,?)').run(id, Date.now())
    })()
    console.log(`[migrate] applied ${id}`)
  }
}
