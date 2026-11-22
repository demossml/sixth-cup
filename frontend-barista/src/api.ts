/** Единственное место, которое ходит в /api/staff. Токен живёт в localStorage устройства бариста. */
const KEY = 'barista_staff_token'

export const tokenStore = {
  get(): string {
    try { return localStorage.getItem(KEY) ?? '' } catch { return '' }
  },
  set(token: string) {
    try { localStorage.setItem(KEY, token) } catch { /* приватный режим — сессия до перезагрузки */ }
  },
  clear() {
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
  },
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** 401 — сессия истекла или пользователя отключили: интерфейс возвращает на вход. */
export function isUnauthorized(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401
}

type Init = { method?: string; body?: unknown; token?: string }

async function request(path: string, init: Init = {}): Promise<Response> {
  const token = init.token ?? tokenStore.get()
  const res = await fetch(`/api/staff${path}`, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!res.ok) {
    let message = `Ошибка ${res.status}`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body?.error === 'string' && body.error) message = body.error
    } catch { /* тело не JSON — оставляем статус */ }
    throw new ApiError(message, res.status)
  }
  return res
}

export async function apiGet<T>(path: string): Promise<T> {
  return (await (await request(path)).json()) as T
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return (await (await request(path, { method: 'POST', body })).json()) as T
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return (await (await request(path, { method: 'PATCH', body })).json()) as T
}

export type LoginResult = {
  token: string
  role: 'owner' | 'admin' | 'barista'
  storeUuid: string | null
  alertBlink: boolean
  displayName: string | null
  login: string
}

export async function login(loginValue: string, password: string): Promise<LoginResult> {
  const res = await request('/login', { method: 'POST', body: { login: loginValue, password }, token: '' })
  return (await res.json()) as LoginResult
}
