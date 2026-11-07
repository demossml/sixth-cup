/**
 * Подписка на push «заказ готов».
 *
 * Один раз спрашиваем разрешение, подписку храним на сервере (endpoint + ключи).
 * Если сервер без VAPID-ключей — тихо выключаемся: заказ работает и без уведомлений.
 */
const base = () => (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE || ''
const apiUrl = (path: string) => `${base()}${path}`

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const b64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

export type PushState = 'unsupported' | 'disabled' | 'prompt' | 'subscribed' | 'denied'

const token = () => {
  try { return localStorage.getItem('sc-jwt') || '' } catch { return '' }
}

/** Поддерживает ли браузер и настроен ли сервер. */
export async function pushAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false
  try {
    const r = await fetch(`${base()}/api/push/public-key`)
    return r.ok
  } catch {
    return false
  }
}

export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined') return 'unsupported'
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (!(await pushAvailable())) return 'disabled'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) return 'subscribed'
  } catch { /* нет регистрации — предложим подписаться */ }
  return Notification.permission === 'granted' ? 'prompt' : 'prompt'
}

/** Подписаться: разрешение → pushManager.subscribe → сохранить на сервере. */
export async function subscribePush(): Promise<PushState> {
  if (!(await pushAvailable())) return 'disabled'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const keyRes = await fetch(`${base()}/api/push/public-key`)
  const { publicKey } = (await keyRes.json()) as { publicKey: string }
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  const res = await fetch(apiUrl('/api/push/subscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
      userAgent: navigator.userAgent,
    }),
  })
  return res.ok ? 'subscribed' : 'prompt'
}
