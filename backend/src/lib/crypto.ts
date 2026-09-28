import { ed25519 } from '@noble/curves/ed25519'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config'

export const b64u = {
  enc: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
  dec: (s: string) => new Uint8Array(Buffer.from(s, 'base64url')),
}

function loadPrivateKey(): Uint8Array {
  if (existsSync(config.keysPath)) {
    const k = JSON.parse(readFileSync(config.keysPath, 'utf8')) as { priv: string }
    return b64u.dec(k.priv)
  }
  const priv = ed25519.utils.randomPrivateKey()
  mkdirSync(dirname(config.keysPath), { recursive: true })
  writeFileSync(config.keysPath, JSON.stringify({ priv: b64u.enc(priv) }), { mode: 0o600 })
  return priv
}

const privateKey = loadPrivateKey()

export const serverPub = b64u.enc(ed25519.getPublicKey(privateKey))

export function signToken(payload: object): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  return `${b64u.enc(bytes)}.${b64u.enc(ed25519.sign(bytes, privateKey))}`
}

export function verifyWith(token: string, pubKeyB64: string): unknown | null {
  const [p, s] = token.split('.')
  if (!p || !s) return null
  try {
    const bytes = b64u.dec(p)
    if (!ed25519.verify(b64u.dec(s), bytes, b64u.dec(pubKeyB64))) return null
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

export function peek(token: string): { t?: string; d?: number } | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'))
  } catch {
    return null
  }
}
