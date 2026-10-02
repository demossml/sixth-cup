import { api, unwrap } from '../api'
import { allReceipts, kvGet, kvSet, putReceipt } from './db'
import { refreshDirectory } from './directory'
import { newest, verifyProof, type Verified } from './proof'
import type { CardState, Directory, Me } from './types'

export type Best = { state: CardState; token: string }

export async function computeBest(dir: Directory, me: Me): Promise<Best | null> {
  const tokens: string[] = []
  const card = await kvGet<string>('card')
  if (card) tokens.push(card)
  for (const r of await allReceipts()) tokens.push(r.token)

  const ok: (Verified & { token: string })[] = []
  for (const t of tokens) {
    const v = verifyProof(t, dir)
    if (v && v.payload.u === me.id) ok.push({ ...v, token: t })
  }
  const best = newest(ok) as (Verified & { token: string }) | null
  return best ? { state: best.payload, token: best.token } : null
}

export async function addReceipt(token: string, dir: Directory | null, me: Me | null) {
  if (!dir || !me) return { ok: false as const, reason: 'Нужно один раз подключиться к интернету.' }
  const v = verifyProof(token, dir)
  if (!v || v.kind !== 'receipt')
    return { ok: false as const, reason: 'Это не чек кассы (или касса новая — обновите по Wi-Fi).' }
  if (v.payload.u !== me.id) return { ok: false as const, reason: 'Этот чек относится к другой карте.' }
  await putReceipt({ id: (v.payload as { r: string }).r, token, uploaded: 0, userId: me.id, q: v.payload.q })
  return { ok: true as const }
}

export type SyncStatus = 'ok' | 'offline' | 'auth'

export async function syncCustomer(): Promise<SyncStatus> {
  const dir = await refreshDirectory()
  if (!dir) return 'offline'

  const pending = (await allReceipts()).filter((r) => !r.uploaded)
  try {
    const res = await unwrap(api.api.sync.$post({ json: { receipts: pending.map((r) => r.token) } }))
    await kvSet('card', res.card)
    await kvSet('me', res.me)
    const done = new Set([...res.result.applied, ...res.result.duplicates])
    for (const r of pending) if (done.has(r.id)) await putReceipt({ ...r, uploaded: 1 })
    localStorage.setItem('sc-last-sync', String(Date.now()))
    return 'ok'
  } catch (e) {
    const m = (e as Error).message
    return m === 'Unauthorized' || m === 'Invalid token' ? 'auth' : 'offline'
  }
}
