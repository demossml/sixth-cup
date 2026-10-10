/**
 * Referral invite handling (pure logic, storage is injected so it is unit-testable).
 *
 * Rules:
 *  - an invite link is remembered only when the browser has NO account yet (no JWT);
 *    an existing account is never rebound by opening somebody's link;
 *  - the remembered code carries a timestamp and expires, so a code from an old visit
 *    cannot be attached to a card created weeks later;
 *  - the code is removed after the account was created (or restored) and when the card is reset.
 */
export const INVITE_KEY = 'sc-invite'
export const INVITE_TTL_MS = 14 * 24 * 3600 * 1000

export type KV = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Server invite codes are 10 chars of base64url upper-case; be a bit more permissive but reject junk. */
const CODE_RE = /^[A-Za-z0-9_-]{4,40}$/

/** localStorage may be missing or throw (private mode); the app must still work. */
export function browserStore(): KV | null {
  try {
    const s = (globalThis as { localStorage?: KV }).localStorage
    return s ?? null
  } catch {
    return null
  }
}

/**
 * Reads `?invite=` from the current URL.
 * Returns `strip: true` when the parameter was present (the caller removes it from the address bar
 * so a reload / back navigation cannot re-apply it).
 */
export function captureInvite(
  search: string,
  hasAccount: boolean,
  store: KV | null = browserStore(),
  now = Date.now(),
): { strip: boolean; stored: boolean } {
  const raw = new URLSearchParams(search).get('invite')
  if (raw === null) return { strip: false, stored: false }
  const code = raw.trim()
  if (hasAccount || !CODE_RE.test(code) || !store) return { strip: true, stored: false }
  try {
    store.setItem(INVITE_KEY, JSON.stringify({ code, at: now }))
    return { strip: true, stored: true }
  } catch {
    return { strip: true, stored: false }
  }
}

/** The code to send with account creation, or undefined (expired / legacy / broken entries are dropped). */
export function getInvite(store: KV | null = browserStore(), now = Date.now()): string | undefined {
  if (!store) return undefined
  try {
    const raw = store.getItem(INVITE_KEY)
    if (raw === null) return undefined
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { parsed = null }
    const p = parsed as { code?: unknown; at?: unknown } | null
    // Legacy value (a bare string without a timestamp) cannot be trusted to be fresh → drop it.
    if (!p || typeof p.code !== 'string' || typeof p.at !== 'number' || !CODE_RE.test(p.code) || now - p.at > INVITE_TTL_MS || p.at > now + 60_000) {
      store.removeItem(INVITE_KEY)
      return undefined
    }
    return p.code
  } catch {
    return undefined
  }
}

export function clearInvite(store: KV | null = browserStore()): void {
  try { store?.removeItem(INVITE_KEY) } catch { /* ignore */ }
}

/** Server rejects an unknown code with this message; the client then retries without the invite. */
export function isInvalidInviteError(e: unknown): boolean {
  return e instanceof Error && /приглашения/i.test(e.message)
}
