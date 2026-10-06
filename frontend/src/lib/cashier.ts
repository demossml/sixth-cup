import { deviceApi, unwrap, api } from '../api'
import { b64u, newKeypair, signPayload } from './crypto'
import { allReceipts, kvGet, kvSet, putReceipt, putSeen } from './db'
import { refreshDirectory } from './directory'
import type { CardState, ReceiptPayload } from './types'

export type DeviceCreds = { deviceId: number; token: string; priv: string; storeName: string }

export const loadCreds = () => kvGet<DeviceCreds>('device')

export async function enroll(code: string): Promise<DeviceCreds> {
  const { priv, pub } = newKeypair()
  const res = await unwrap(api.api.devices.enroll.$post({ json: { code, publicKey: b64u.enc(pub) } }))
  const creds: DeviceCreds = { deviceId: res.deviceId, token: res.deviceToken, priv: b64u.enc(priv), storeName: res.storeName }
  await kvSet('device', creds)
  return creds
}

function newReceiptId(deviceId: number) {
  const rnd = crypto.getRandomValues(new Uint8Array(3))
  return `${deviceId}-${Date.now().toString(36)}-${b64u.enc(rnd)}`
}

export async function createReceipt(
  creds: DeviceCreds, base: CardState, userId: number,
  o: { cups: number; useFree: boolean; voucherId: number | null; cashbackUse: number; amount: number },
) {
  const vu = o.voucherId ? [o.voucherId] : []
  const dcb = Math.min(o.cashbackUse, base.cb)
  const payload: ReceiptPayload = {
    t: 'r', r: newReceiptId(creds.deviceId), u: userId, d: creds.deviceId,
    q: base.q + 1,
    p: base.p + o.cups,
    f: base.f + (o.useFree ? 1 : 0),
    v: base.v.filter((x) => !vu.includes(x[0])),
    cb: base.cb - dcb,
    dp: o.cups, df: o.useFree ? 1 : 0, dcb, vu, a: o.amount,
    ts: Math.floor(Date.now() / 1000),
  }
  const token = signPayload(payload, b64u.dec(creds.priv))
  await putReceipt({ id: payload.r, token, uploaded: 0, userId, q: payload.q })
  await putSeen({ userId, q: payload.q, token })
  return { token, payload }
}

export async function syncCashier(creds: DeviceCreds): Promise<'ok' | 'offline'> {
  if (!(await refreshDirectory())) return 'offline'
  const pending = (await allReceipts()).filter((r) => !r.uploaded)
  try {
    const res = await unwrap(deviceApi(creds.token).api.devices.sync.$post({ json: { receipts: pending.map((r) => r.token) } }))
    const done = new Set([...res.result.applied, ...res.result.duplicates])
    for (const r of pending) if (done.has(r.id)) await putReceipt({ ...r, uploaded: 1 })
    return 'ok'
  } catch { return 'offline' }
}
