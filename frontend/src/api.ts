import { hc } from 'hono/client'
import type { AppType } from '@sixth-cup/backend'

export const getJwt = () => localStorage.getItem('sc-jwt')
export const setJwt = (t: string | null) => (t ? localStorage.setItem('sc-jwt', t) : localStorage.removeItem('sc-jwt'))

const timedFetch: typeof fetch = (input, init) => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 8000)
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer))
}

export const api = hc<AppType>('/', {
  fetch: timedFetch,
  headers: (): Record<string, string> => {
    const t = getJwt()
    return t ? { Authorization: `Bearer ${t}` } : {}
  },
})


export async function unwrap<T>(p: Promise<{ ok: boolean; json: () => Promise<T> }>): Promise<T> {
  const res = await p
  if (!res.ok) {
    const body = (await res.json()) as unknown as { error?: string }
    throw new Error(body.error ?? 'Ошибка запроса')
  }
  return res.json()
}
