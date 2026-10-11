/** Small helpers for filters that live in the address (?a=b), so a view can be sent as a link. */
export function setParams(
  current: URLSearchParams,
  patch: Record<string, string | number | null | undefined>,
): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') next.delete(k)
    else next.set(k, String(v))
  }
  return next
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '' || v === false) continue
    u.set(k, String(v))
  }
  const s = u.toString()
  return s ? `?${s}` : ''
}
