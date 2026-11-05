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
/** Одноразовые сообщения о приглашении, которые нельзя терять молча. */
export const NOTICE_KEY = 'sc-invite-notice'
export const NOTICE_TTL_MS = 7 * 24 * 3600 * 1000

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
export type CaptureResult = {
  /** Параметр был в адресе — его нужно убрать из строки браузера. */
  strip: boolean
  /** Код сохранён и будет отправлен при создании карты. */
  stored: boolean
  /** Валидный код, который НЕ применён (у браузера уже есть карта). Нельзя терять молча. */
  ignored: string | null
}

export function captureInvite(
  search: string,
  hasAccount: boolean,
  store: KV | null = browserStore(),
  now = Date.now(),
): CaptureResult {
  const raw = new URLSearchParams(search).get('invite')
  if (raw === null) return { strip: false, stored: false, ignored: null }
  const code = raw.trim()
  if (!CODE_RE.test(code)) return { strip: true, stored: false, ignored: null }
  // Приглашение привязывается только при создании новой карты: существующую не переписываем.
  if (hasAccount || !store) return { strip: true, stored: false, ignored: code }
  try {
    store.setItem(INVITE_KEY, JSON.stringify({ code, at: now }))
    return { strip: true, stored: true, ignored: null }
  } catch {
    return { strip: true, stored: false, ignored: code }
  }
}

/** Ручной ввод кода (онбординг): тот же формат и срок жизни, что у ссылки. */
export function storeInvite(code: string, store: KV | null = browserStore(), now = Date.now()): boolean {
  const value = code.trim().toUpperCase()
  if (!CODE_RE.test(value) || !store) return false
  try {
    store.setItem(INVITE_KEY, JSON.stringify({ code: value, at: now }))
    return true
  } catch {
    return false
  }
}

/** Проверка формата кода без записи — для подсказки в поле ввода. */
export const isValidInviteCode = (code: string): boolean => CODE_RE.test(code.trim())

/** Гость может вставить код или целую ссылку — вытаскиваем код из любого вида. */
export function parseInviteInput(raw: string): string {
  const value = raw.trim()
  const m = /[?&]invite=([^&\s]+)/i.exec(value)
  const candidate = m ? decodeURIComponent(m[1]) : value
  return candidate.trim().toUpperCase()
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

// ── Сообщения о приглашении, которые нельзя проглотить ────────────────────────
// ignored  — пришли по ссылке, но карта уже есть (привязка только для новых гостей);
// rejected — код не принят сервером, карта создана без приглашения.
export type InviteNotice = { kind: 'ignored' | 'rejected'; code: string; at: number }

export function setInviteNotice(
  notice: { kind: InviteNotice['kind']; code: string },
  store: KV | null = browserStore(),
  now = Date.now(),
): void {
  if (!store) return
  try { store.setItem(NOTICE_KEY, JSON.stringify({ ...notice, at: now })) } catch { /* private mode */ }
}

export function getInviteNotice(store: KV | null = browserStore(), now = Date.now()): InviteNotice | null {
  if (!store) return null
  try {
    const raw = store.getItem(NOTICE_KEY)
    if (raw === null) return null
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { parsed = null }
    const p = parsed as { kind?: unknown; code?: unknown; at?: unknown } | null
    const okKind = p?.kind === 'ignored' || p?.kind === 'rejected'
    if (!p || !okKind || typeof p.code !== 'string' || typeof p.at !== 'number' || now - p.at > NOTICE_TTL_MS) {
      store.removeItem(NOTICE_KEY)
      return null
    }
    return { kind: p.kind as InviteNotice['kind'], code: p.code, at: p.at }
  } catch {
    return null
  }
}

export function clearInviteNotice(store: KV | null = browserStore()): void {
  try { store?.removeItem(NOTICE_KEY) } catch { /* ignore */ }
}
