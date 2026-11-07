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
  /** Когда будет готов (null — ETA ещё не назначен). */
  etaReadyAt?: string | null
  /** Остаток до готовности в минутах на момент ответа. */
  etaMinutes?: number | null
  /** Серверное «сейчас» — обратный отсчёт считаем от него, а не от часов телефона. */
  serverNow?: string
  pickedUpAt?: string | null
  readyBy?: 'auto' | 'cashier' | null
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
    evotorProductUuid?: string | null
  }>
}

/** Ответ `GET /api/orders/active`: активный заказ и (если есть) срок бана за невыкуп. */
export type ActiveOrderState = {
  /** ok=false — запрос не прошёл (сеть/сервер), состояние стоит считать устаревшим. */
  ok: boolean
  order: OrderOut | null
  bannedUntil: string | null
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

/** Активный заказ гостя + срок бана. Сеть/ошибка → null-состояние, экран не падает. */
export async function getActiveOrder(): Promise<ActiveOrderState> {
  try {
    const { res, data } = await jsonFetch('/api/orders/active')
    if (!res.ok || !data.ok) return { ok: false, order: null, bannedUntil: null }
    return { ok: true, order: (data.order as OrderOut) ?? null, bannedUntil: (data.bannedUntil as string) ?? null }
  } catch {
    return { ok: false, order: null, bannedUntil: null }
  }
}

/** «Я забрал»: закрывает активный заказ, оплата и статус для кассы не меняются. */
export async function markReceived(id: string): Promise<boolean> {
  const { res, data } = await jsonFetch(`/api/orders/${id}/received`, { method: 'POST', body: '{}' })
  return res.ok && Boolean(data.ok)
}

/** Тип ошибки создания заказа: по нему UI показывает нужный диалог. */
export type CreateFailure = 'active_order_exists' | 'preorder_banned' | 'other'

export type CreateResult =
  | { ok: true; order: OrderOut; qrPayload: string }
  | { ok: false; error: CreateFailure; message: string; activeOrderId?: string; bannedUntil?: string }

export async function createOrder(body: Parameters<typeof createPreorder>[0]): Promise<CreateResult> {
  const { res, data } = await jsonFetch('/api/orders', { method: 'POST', body: JSON.stringify(body) })
  if (res.ok && data.ok) return { ok: true, order: data.order as OrderOut, qrPayload: String(data.qrPayload) }
  const code = String(data.error || 'error')
  const error: CreateFailure = code === 'active_order_exists' ? 'active_order_exists' : code === 'preorder_banned' ? 'preorder_banned' : 'other'
  return {
    ok: false,
    error,
    message: String(data.message || 'Не удалось создать заказ'),
    activeOrderId: data.activeOrderId ? String(data.activeOrderId) : undefined,
    bannedUntil: data.bannedUntil ? String(data.bannedUntil) : undefined,
  }
}

// ── Локальная ссылка на текущий заказ: нужна баннеру после перезагрузки страницы ──
const ORDER_REF_KEY = 'sc_order_current'

export type OrderRef = { orderId: string; qrPayload: string | null; at: number }

export function saveOrderRef(ref: { orderId: string; qrPayload?: string | null }): void {
  try {
    localStorage.setItem(ORDER_REF_KEY, JSON.stringify({ orderId: ref.orderId, qrPayload: ref.qrPayload ?? null, at: Date.now() }))
  } catch { /* private mode */ }
}

export function loadOrderRef(): OrderRef | null {
  try {
    const raw = localStorage.getItem(ORDER_REF_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<OrderRef>
    if (!p?.orderId || typeof p.orderId !== 'string') return null
    return { orderId: p.orderId, qrPayload: typeof p.qrPayload === 'string' ? p.qrPayload : null, at: Number(p.at) || 0 }
  } catch {
    return null
  }
}

export function clearOrderRef(): void {
  try { localStorage.removeItem(ORDER_REF_KEY) } catch { /* private mode */ }
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
