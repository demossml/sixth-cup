/**
 * Build a browser-usable URL for product/CMS images.
 * Backend may return absolute https://… (when PUBLIC_BASE_URL is set)
 * or a path /uploads/…. Same-origin PWA can load /uploads/ as-is;
 * if VITE_API_URL points to another host, prefix it.
 */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const p = String(path).trim()
  if (!p) return null
  if (/^https?:\/\//i.test(p) || p.startsWith('data:')) return p
  const base = String((import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? '').replace(
    /\/+$/,
    '',
  )
  if (!base) return p.startsWith('/') ? p : `/${p}`
  return `${base}${p.startsWith('/') ? p : `/${p}`}`
}
