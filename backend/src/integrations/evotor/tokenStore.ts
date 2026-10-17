/**
 * Multi cloud-API tokens for Evotor (admin-managed).
 * resolveToken(storeUuid) → token for poll/push; env EVOTOR_API_TOKEN is fallback.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import type Database from 'better-sqlite3'
import { config, evotorConfig } from '../../config'
import { EvotorClient } from './client/EvotorClient'

const ALGO = 'aes-256-gcm'

function encKey(): Buffer {
  const raw = (process.env.TOKEN_ENCRYPTION_KEY || config.jwtSecret || 'dev-token-key').trim()
  return scryptSync(raw, 'sixth-cup-evotor-tokens', 32)
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, encKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptToken(blob: string): string {
  if (!blob.startsWith('v1:')) return blob // legacy plaintext (should not happen)
  const [, ivB64, tagB64, dataB64] = blob.split(':')
  const decipher = createDecipheriv(ALGO, encKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

export function tokenHint(plain: string): string {
  const s = plain.trim()
  if (s.length <= 4) return '****'
  return `…${s.slice(-4)}`
}

export function ensureTokenSchema(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS evotor_api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  token_enc TEXT NOT NULL,
  token_hint TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS evotor_token_stores (
  token_id INTEGER NOT NULL REFERENCES evotor_api_tokens(id) ON DELETE CASCADE,
  store_uuid TEXT NOT NULL,
  PRIMARY KEY (token_id, store_uuid)
);
CREATE INDEX IF NOT EXISTS idx_evotor_token_stores_store ON evotor_token_stores(store_uuid);
`)
  // One-time import of env token if DB has no rows
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM evotor_api_tokens`).get() as { n: number }).n
  const envTok = (evotorConfig.apiToken || '').trim()
  if (n === 0 && envTok) {
    const now = Date.now()
    const info = db.prepare(
      `INSERT INTO evotor_api_tokens(label, token_enc, token_hint, active, created_at, updated_at, created_by)
       VALUES(?,?,?,1,?,?,?)`,
    ).run('env-legacy', encryptToken(envTok), tokenHint(envTok), now, now, 'migration')
    const tokenId = Number(info.lastInsertRowid)
    const stores = db.prepare(`SELECT store_uuid FROM evotor_stores`).all() as { store_uuid: string }[]
    const ins = db.prepare(`INSERT OR IGNORE INTO evotor_token_stores(token_id, store_uuid) VALUES(?,?)`)
    for (const s of stores) ins.run(tokenId, s.store_uuid)
  }
}

/** Plain token for a store, or env fallback, or null. */
export function resolveToken(db: Database.Database, storeUuid: string): string | null {
  ensureTokenSchema(db)
  const row = db.prepare(`
    SELECT t.token_enc FROM evotor_api_tokens t
    JOIN evotor_token_stores ts ON ts.token_id = t.id
    WHERE ts.store_uuid = ? AND t.active = 1
    ORDER BY t.id DESC LIMIT 1
  `).get(storeUuid) as { token_enc: string } | undefined
  if (row?.token_enc) {
    try { return decryptToken(row.token_enc) } catch { /* fall through */ }
  }
  const envTok = (evotorConfig.apiToken || '').trim()
  return envTok || null
}

/** All distinct active plain tokens (for ensureStores across cabinets). */
export function listActivePlainTokens(db: Database.Database): string[] {
  ensureTokenSchema(db)
  const rows = db.prepare(`SELECT token_enc FROM evotor_api_tokens WHERE active=1`).all() as { token_enc: string }[]
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    try {
      const p = decryptToken(r.token_enc)
      if (p && !seen.has(p)) { seen.add(p); out.push(p) }
    } catch { /* skip */ }
  }
  const envTok = (evotorConfig.apiToken || '').trim()
  if (envTok && !seen.has(envTok)) out.push(envTok)
  return out
}

export function anyTokenConfigured(db: Database.Database): boolean {
  return listActivePlainTokens(db).length > 0
}

export function clientForStore(db: Database.Database, storeUuid: string): EvotorClient {
  const tok = resolveToken(db, storeUuid)
  if (!tok) return new EvotorClient('') // isConfigured false
  return new EvotorClient(tok)
}

export type TokenPublic = {
  id: number
  label: string
  tokenHint: string
  active: boolean
  storeUuids: string[]
  createdAt: number
  updatedAt: number
}

export function listTokensPublic(db: Database.Database): TokenPublic[] {
  ensureTokenSchema(db)
  const tokens = db.prepare(
    `SELECT id, label, token_hint AS tokenHint, active, created_at AS createdAt, updated_at AS updatedAt FROM evotor_api_tokens ORDER BY id`,
  ).all() as { id: number; label: string; tokenHint: string; active: number; createdAt: number; updatedAt: number }[]
  const linkStmt = db.prepare(`SELECT store_uuid AS u FROM evotor_token_stores WHERE token_id=?`)
  return tokens.map((t) => ({
    id: t.id,
    label: t.label,
    tokenHint: t.tokenHint,
    active: t.active === 1,
    storeUuids: (linkStmt.all(t.id) as { u: string }[]).map((r) => r.u),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }))
}

export function createToken(
  db: Database.Database,
  input: { label: string; token: string; storeUuids: string[]; createdBy?: string },
): TokenPublic {
  ensureTokenSchema(db)
  const plain = input.token.trim()
  if (!plain) throw new Error('token required')
  const now = Date.now()
  const info = db.prepare(
    `INSERT INTO evotor_api_tokens(label, token_enc, token_hint, active, created_at, updated_at, created_by)
     VALUES(?,?,?,1,?,?,?)`,
  ).run(input.label.trim() || 'Токен', encryptToken(plain), tokenHint(plain), now, now, input.createdBy ?? 'admin')
  const id = Number(info.lastInsertRowid)
  setTokenStores(db, id, input.storeUuids)
  return listTokensPublic(db).find((t) => t.id === id)!
}

export function setTokenStores(db: Database.Database, tokenId: number, storeUuids: string[]): void {
  // One active token per store: detach these stores from other tokens
  const delOther = db.prepare(`DELETE FROM evotor_token_stores WHERE store_uuid=? AND token_id!=?`)
  const ins = db.prepare(`INSERT OR IGNORE INTO evotor_token_stores(token_id, store_uuid) VALUES(?,?)`)
  db.prepare(`DELETE FROM evotor_token_stores WHERE token_id=?`).run(tokenId)
  for (const u of storeUuids) {
    const uuid = String(u).trim()
    if (!uuid) continue
    delOther.run(uuid, tokenId)
    ins.run(tokenId, uuid)
  }
  db.prepare(`UPDATE evotor_api_tokens SET updated_at=? WHERE id=?`).run(Date.now(), tokenId)
}

export function updateToken(
  db: Database.Database,
  id: number,
  patch: { label?: string; token?: string; active?: boolean; storeUuids?: string[] },
): TokenPublic | null {
  ensureTokenSchema(db)
  const row = db.prepare(`SELECT id FROM evotor_api_tokens WHERE id=?`).get(id)
  if (!row) return null
  if (patch.label != null) db.prepare(`UPDATE evotor_api_tokens SET label=?, updated_at=? WHERE id=?`).run(patch.label.trim(), Date.now(), id)
  if (patch.active != null) db.prepare(`UPDATE evotor_api_tokens SET active=?, updated_at=? WHERE id=?`).run(patch.active ? 1 : 0, Date.now(), id)
  if (patch.token != null && patch.token.trim()) {
    const plain = patch.token.trim()
    db.prepare(`UPDATE evotor_api_tokens SET token_enc=?, token_hint=?, updated_at=? WHERE id=?`)
      .run(encryptToken(plain), tokenHint(plain), Date.now(), id)
  }
  if (patch.storeUuids) setTokenStores(db, id, patch.storeUuids)
  return listTokensPublic(db).find((t) => t.id === id) ?? null
}

export function deactivateToken(db: Database.Database, id: number): boolean {
  ensureTokenSchema(db)
  const r = db.prepare(`UPDATE evotor_api_tokens SET active=0, updated_at=? WHERE id=?`).run(Date.now(), id)
  return r.changes > 0
}
