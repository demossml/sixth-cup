import { api, getJwt, setJwt, unwrap } from '../api'
import { clearInvite, getInvite, isInvalidInviteError } from './invite'

/** Anonymous account without phone/SMS. */
export async function ensureGuest(): Promise<'ok' | 'offline'> {
  if (getJwt()) return 'ok'
  const invite = getInvite()
  const create = (inviteCode?: string) =>
    unwrap(api.api.auth.guest.$post({ json: inviteCode ? { inviteCode } : {} })) as Promise<{ token: string }>
  try {
    let r: { token: string }
    try {
      r = await create(invite)
    } catch (e) {
      // A code the server does not know (old database, typo) must not block the card forever.
      if (invite && isInvalidInviteError(e)) {
        clearInvite()
        r = await create(undefined)
      } else {
        throw e // network trouble: keep the invite for the next attempt
      }
    }
    setJwt(r.token)
    clearInvite() // consumed: it must never leak into the next card
    return 'ok'
  } catch {
    return 'offline'
  }
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
