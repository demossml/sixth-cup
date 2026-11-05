import { api, getJwt, setJwt, unwrap, type ApiError } from '../api'
import { clearInvite, getInvite, isInvalidInviteError, setInviteNotice, storeInvite } from './invite'
import { clearUserData } from './db'

/**
 * Почему карту не выдали. Разные причины должны звучать по-разному:
 * «нет сети» на 429/битый код — это ложь, из-за которой гость не понимает, что делать.
 */
export type GuestResult = 'ok' | 'offline' | 'rate_limited' | 'invalid_invite'

let guestFlight: Promise<GuestResult> | null = null

const isRateLimit = (e: unknown) => (e as ApiError)?.status === 429 || /слишком много/i.test((e as Error)?.message ?? '')

async function create(inviteCode?: string): Promise<{ token: string }> {
  return unwrap(api.api.auth.guest.$post({ json: inviteCode ? { inviteCode } : {} })) as Promise<{ token: string }>
}

/** Регистрация гостя без карты. При неизвестном коде карта всё равно выдаётся, но без реферера. */
export function ensureGuest(): Promise<GuestResult> {
  if (getJwt()) return Promise.resolve('ok')
  if (!guestFlight) guestFlight = createGuest().finally(() => { guestFlight = null })
  return guestFlight
}

async function createGuest(): Promise<GuestResult> {
  if (getJwt()) return 'ok'
  const invite = getInvite()
  try {
    let r: { token: string }
    try {
      r = await create(invite)
    } catch (e) {
      if (isRateLimit(e)) return 'rate_limited'
      // Код, которого нет в базе (старая ссылка, опечатка), не должен блокировать карту навсегда,
      // но и молчать о нём нельзя: покажем это на титуле.
      if (invite && isInvalidInviteError(e)) {
        clearInvite()
        setInviteNotice({ kind: 'rejected', code: invite })
        r = await create(undefined)
        setJwt(r.token)
        return 'invalid_invite'
      }
      throw e
    }
    setJwt(r.token)
    clearInvite() // consumed: it must never leak into the next card
    return 'ok'
  } catch (e) {
    return isRateLimit(e) ? 'rate_limited' : 'offline'
  }
}

/**
 * Строгое применение кода (онбординг «У меня есть код друга»).
 * Ничего не создаёт при ошибке: гость может исправить код и попробовать снова.
 */
export async function applyInvite(code: string): Promise<GuestResult> {
  if (getJwt()) return 'ok' // карта уже есть — привязка только через сброс (resetCardWithInvite)
  if (!storeInvite(code)) return 'invalid_invite'
  try {
    const r = await create(code.trim().toUpperCase())
    setJwt(r.token)
    clearInvite()
    return 'ok'
  } catch (e) {
    clearInvite()
    if (isRateLimit(e)) return 'rate_limited'
    if (isInvalidInviteError(e)) return 'invalid_invite'
    return 'offline'
  }
}

/**
 * Осознанный сброс карты «начать по приглашению»: старый аккаунт не переписываем —
 * создаём нового гостя и передаём код при регистрации.
 */
export async function resetCardWithInvite(code: string): Promise<GuestResult> {
  setJwt(null)
  clearInvite()
  await clearUserData()
  try {
    localStorage.removeItem('sc-saved')
    localStorage.removeItem('sc-guest-nonce')
  } catch { /* private mode */ }
  return applyInvite(code)
}

/** Восстановление аккаунта по коду/QR сохранения. */
export async function restoreAccount(recovery: string): Promise<boolean> {
  try {
    const r = await unwrap(api.api.auth.restore.$post({ json: { recovery } })) as { token: string }
    setJwt(r.token)
    clearInvite() // a restored account keeps its own referrer; a pending invite must not follow it
    return true
  } catch {
    return false
  }
}
