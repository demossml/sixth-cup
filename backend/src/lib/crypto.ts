import { ed25519 } from '@noble/curves/ed25519'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { config } from '../config'

export const b64u = {
  enc: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
  dec: (s: string) => new Uint8Array(Buffer.from(s, 'base64url')),
}

type KeyRecord = { priv: string; pub: string }
type KeyFile = { currentKid: string; keys: Record<string, KeyRecord> }

function loadKeyFile(): KeyFile {
  if (existsSync(config.keysPath)) {
    const raw = JSON.parse(readFileSync(config.keysPath, 'utf8')) as Partial<KeyFile> & { priv?: string }
    if (raw.currentKid && raw.keys?.[raw.currentKid]) return raw as KeyFile
    if (raw.priv) {
      const priv = b64u.dec(raw.priv)
      const kid = 'k1'
      const migrated: KeyFile = {
        currentKid: kid,
        keys: { [kid]: { priv: b64u.enc(priv), pub: b64u.enc(ed25519.getPublicKey(priv)) } },
      }
      writeFileSync(config.keysPath, JSON.stringify(migrated, null, 2), { mode: 0o600 })
      return migrated
    }
  }

  const priv = randomBytes(32)
  const kid = `k-${Date.now().toString(36)}`
  const file: KeyFile = {
    currentKid: kid,
    keys: { [kid]: { priv: b64u.enc(priv), pub: b64u.enc(ed25519.getPublicKey(priv)) } },
  }
  mkdirSync(dirname(config.keysPath), { recursive: true })
  writeFileSync(config.keysPath, JSON.stringify(file, null, 2), { mode: 0o600 })
  return file
}

const keyFile = loadKeyFile()
export const serverKid = keyFile.currentKid
export const serverPub = keyFile.keys[serverKid].pub
export const serverKeys = Object.entries(keyFile.keys).map(([kid, key]) => ({ kid, pub: key.pub }))

const te = new TextEncoder()
const td = new TextDecoder()

export function signToken(payload: Record<string, unknown>): string {
  const full = { kid: serverKid, ...payload }
  const bytes = te.encode(JSON.stringify(full))
  const priv = b64u.dec(keyFile.keys[serverKid].priv)
  return `${b64u.enc(bytes)}.${b64u.enc(ed25519.sign(bytes, priv))}`
}

export function verifyWith(token: string, pubKeyB64: string): unknown | null {
  const [p, s] = token.split('.')
  if (!p || !s) return null
  try {
    const bytes = b64u.dec(p)
    if (!ed25519.verify(b64u.dec(s), bytes, b64u.dec(pubKeyB64))) return null
    return JSON.parse(td.decode(bytes))
  } catch {
    return null
  }
}

export function verifyServerToken(token: string): Record<string, unknown> | null {
  const head = peek<Record<string, unknown>>(token)
  const kid = typeof head?.kid === 'string' ? head.kid : null
  const key = kid ? keyFile.keys[kid] : null
  if (!key) return null
  const payload = verifyWith(token, key.pub)
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  if (typeof p.exp === 'number' && p.exp < Math.floor(Date.now() / 1000)) return null
  return p
}

export function peek<T = { t?: string; d?: number; kid?: string; exp?: number }>(token: string): T | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}
