import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config'
import { SCHEMA } from './schema'
import { runMigrations } from './migrate'
import { migrateEvotorSchema } from '../integrations/evotor/db'
import { dedupeCategoriesByName } from '../modules/catalog/addonScheme'

mkdirSync(dirname(config.dbPath), { recursive: true })
mkdirSync(config.uploadsDir, { recursive: true })

export const db = new Database(config.dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(SCHEMA)
migrateEvotorSchema(db)
runMigrations(db)

const collapsed = dedupeCategoriesByName(db)
if (collapsed > 0) console.log(`[migrate] collapsed ${collapsed} duplicate categor${collapsed === 1 ? 'y' : 'ies'}`)
