/** Guest pre-order API client for PWA */

export type CartModifier = { groupKey: string; modifierId: string; name?: string; price?: number }
export type CartLine = {
  key: string
  productId: string
  name: string
  quantity: number
  volumeId?: string
  volumeLabel?: string
  unitPriceEstimate: number
  modifiers: CartModifier[]
  configText: string
}

export type OrderOut = {
  id: string
  shortCode: string
  storeId: number
  status: string
  createdAt: string
  expiresAt: string
  estimateTotal: number
  currency: string
  cardId: string | null
  items: Array<{
    lineId: string
    productId: string
    name: string
    quantity: number
    volumeLabel: string | null
    configText: string
    unitPriceEstimate: number
  }>
}

const base = () => (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE || ''

/**
 * Гость авторизован Bearer-JWT (как весь остальной PWA API), поэтому заголовок обязателен:
 * без него заказ не привяжется к карте. `credentials: 'include'` оставлен для прокси.
 */
async function jsonFetch(path: string, init?: RequestInit) {
  const { getJwt } = await import('../api')
  const token = getJwt()
  const res = await fetch(`${base()}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

export async function createPreorder(body: {
  storeId: number | string
  cardId?: string | null
  items: Array<{
    productId: string
    quantity: number
    volumeId?: string
    modifiers?: Array<{ groupKey: string; modifierId: string }>
  }>
}): Promise<{ ok: true; order: OrderOut; qrPayload: string } | { ok: false; error: string; message: string }> {
  const { res, data } = await jsonFetch('/api/orders', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok || !data.ok) return { ok: false, error: data.error || 'error', message: data.message || 'Ошибка создания заказа' }
  return { ok: true, order: data.order, qrPayload: data.qrPayload }
}

export async function getPreorder(id: string): Promise<OrderOut | null> {
  const { res, data } = await jsonFetch(`/api/orders/${id}`)
  if (!res.ok || !data.ok) return null
  return data.order as OrderOut
}

export async function cancelPreorder(id: string): Promise<boolean> {
  const { res, data } = await jsonFetch(`/api/orders/${id}/cancel`, { method: 'POST', body: '{}' })
  return res.ok && data.ok
}

const CART_KEY = '67_preorder_cart_v1'

export function loadCart(): CartLine[] {
  try {
    const raw = sessionStorage.getItem(CART_KEY)
    return raw ? (JSON.parse(raw) as CartLine[]) : []
  } catch {
    return []
  }
}

export function saveCart(lines: CartLine[]) {
  sessionStorage.setItem(CART_KEY, JSON.stringify(lines))
}

export function clearCart() {
  sessionStorage.removeItem(CART_KEY)
}

export function cartTotal(lines: CartLine[]) {
  return lines.reduce((s, l) => s + l.unitPriceEstimate * l.quantity, 0)
}
