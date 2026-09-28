import { ed25519 } from '@noble/curves/ed25519'

export const b64u = {
  enc(bytes: Uint8Array): string {
    let s = ''
    bytes.forEach((b) => (s += String.fromCharCode(b)))
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  dec(str: string): Uint8Array {
    const s = str.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  },
}
const te = new TextEncoder()
const td = new TextDecoder()

export function peek<T>(token: string): T | null {
  try { return JSON.parse(td.decode(b64u.dec(token.split('.')[0] ?? ''))) as T } catch { return null }
}

export function openToken<T>(token: string, pubKeyB64: string): T | null {
  const [p, s] = token.split('.')
  if (!p || !s) return null
  try {
    const bytes = b64u.dec(p)
    if (!ed25519.verify(b64u.dec(s), bytes, b64u.dec(pubKeyB64))) return null
    return JSON.parse(td.decode(bytes)) as T
  } catch { return null }
}

export function signPayload(payload: object, privateKey: Uint8Array): string {
  const bytes = te.encode(JSON.stringify(payload))
  return `${b64u.enc(bytes)}.${b64u.enc(ed25519.sign(bytes, privateKey))}`
}

export function newKeypair() {
  const priv = ed25519.utils.randomPrivateKey()
  return { priv, pub: ed25519.getPublicKey(priv) }
}
