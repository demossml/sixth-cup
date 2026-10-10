const TOKEN_KEY = 'admin_token'

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}
export function setAdminToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t)
}
export function clearAdminToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function adminFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('X-Admin-Token', getAdminToken())
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await fetch(`/api/admin${path}`, { ...init, headers })
  if (res.status === 403) {
    clearAdminToken()
    throw new Error('Forbidden')
  }
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = await res.json()
      msg = (j as any).error ?? msg
    } catch { /* */ }
    throw new Error(msg)
  }
  if (res.headers.get('content-type')?.includes('text/csv')) {
    return (await res.text()) as T
  }
  return res.json() as Promise<T>
}
