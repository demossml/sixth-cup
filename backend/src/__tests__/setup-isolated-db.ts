/**
 * Safety net for test isolation.
 *
 * `src/db/index.ts` opens the database at import time from `config.dbPath`, and ES imports
 * are hoisted above any `process.env.DB_PATH = ...` written in a test file. Files that forgot
 * to set the path therefore wrote into the real `backend/data/sixth-cup.db`.
 *
 * Setup files run before the test module is imported, so pointing the env at a fresh temp
 * directory here protects every test, including future ones. Files that need their own path
 * still override these values at the top of the file.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-vitest-'))

process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'test-admin'
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development'
