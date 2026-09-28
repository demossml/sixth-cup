import { openToken, peek } from './crypto'
import type { CardProof, CardState, Directory, ReceiptPayload } from './types'

export const todayDay = () => Math.floor(Date.now() / 86_400_000)

export const freeAvailable = (s: CardState, n: number) => Math.floor(s.p / n) - s.f
export const progress = (s: CardState, n: number) => s.p % n
export const activeVouchers = (s: CardState) => s.v.filter((v) => v[3] >= todayDay())

export type Verified = { kind: 'card' | 'receipt'; payload: CardProof | ReceiptPayload; at: number }

export function verifyProof(token: string, dir: Directory): Verified | null {
  const head = peek<{ t?: string; d?: number }>(token)
  if (!head) return null

  if (head.t === 'c') {
    const p = openToken<CardProof>(token, dir.serverPub)
    return p ? { kind: 'card', payload: p, at: p.i } : null
  }
  if (head.t === 'r') {
    const dev = dir.devices.find((d) => d.id === head.d && !d.revoked)
    if (!dev) return null
    const p = openToken<ReceiptPayload>(token, dev.pub)
    return p ? { kind: 'receipt', payload: p, at: p.ts } : null
  }
  return null
}

export function newest(list: Verified[]): Verified | null {
  return list.sort((a, b) => b.payload.q - a.payload.q || b.at - a.at)[0] ?? null
}

export function discountFor(v: CardState['v'][number] | undefined, amount: number) {
  if (!v) return 0
  return v[1] === 'p' ? Math.floor((amount * v[2]) / 100) : Math.min(v[2], amount)
}
