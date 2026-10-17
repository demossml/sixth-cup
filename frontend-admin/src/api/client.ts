/** One place that talks to /api/admin. The token lives in localStorage under the same key as the legacy admin. */
const API = (import.meta as any).env?.VITE_API_URL ?? ''
const KEY = 'admin_token'

export const tokenStore = {
  get(): string {
    try { return localStorage.getItem(KEY) || '' } catch { return '' }
  },
  set(v: string) {
    try { localStorage.setItem(KEY, v) } catch { /* private mode: token lives only until reload */ }
  },
  clear() {
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
  },
}

/**
 * Human-readable message from an error body. The server answers either `{error: "text"}` or, for zod
 * validation, `{success:false, error:{issues:[{path, message}]}}` — never show the object itself.
 */
export function errorText(body: unknown, fallback: string): string {
  const e = (body as { error?: unknown } | null | undefined)?.error
  if (typeof e === 'string' && e) return e
  const issues = (e as { issues?: { path?: (string | number)[]; message?: string }[] } | undefined)?.issues
  if (Array.isArray(issues) && issues.length) {
    const i = issues[0]
    const where = i.path?.length ? `${i.path.join('.')}: ` : ''
    return `Проверьте данные — ${where}${i.message ?? 'некорректное значение'}`
  }
  return fallback
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

type Init = { method?: string; body?: unknown; signal?: AbortSignal }

async function raw(path: string, init: Init = {}): Promise<Response> {
  const res = await fetch(`${API}/api/admin${path}`, {
    method: init.method ?? 'GET',
    signal: init.signal,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': tokenStore.get() },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const message = errorText(err, res.statusText || `Ошибка ${res.status}`)
    // Only a rejected token logs the user out; other 403s (e.g. "reset disabled") are ordinary errors.
    if (res.status === 403 && message === 'Forbidden') onUnauthorized?.()
    throw new ApiError(message, res.status)
  }
  return res
}

export async function api<T>(path: string, init?: Init): Promise<T> {
  return (await raw(path, init)).json() as Promise<T>
}

/** Download a file endpoint (CSV) with the token header, then hand it to the browser. */
export async function download(path: string, filename: string) {
  const blob = await (await raw(path)).blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Upload a photo/video to /api/admin/upload with the same error handling as every other call. */
export async function uploadFile(file: File): Promise<{ url: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${API}/api/admin/upload`, {
    method: 'POST',
    headers: { 'X-Admin-Token': tokenStore.get() },
    body: fd,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const message = errorText(err, res.statusText || `Ошибка ${res.status}`)
    if (res.status === 403 && message === 'Forbidden') onUnauthorized?.()
    throw new ApiError(message, res.status)
  }
  const j = (await res.json()) as { url?: string }
  if (!j.url) throw new ApiError('Нет url в ответе', 502)
  return { url: j.url }
}
