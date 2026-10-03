import { api, getJwt, setJwt, unwrap } from '../api'

/** Один раз выдаёт карту без телефона. Повторно не трогает сессию. */
export async function ensureGuest(): Promise<'ok' | 'offline'> {
  if (getJwt()) return 'ok'
  const invite = localStorage.getItem('sc-invite') ?? undefined
  try {
    const r = await unwrap(
      api.api.auth.guest.$post({ json: invite ? { inviteCode: invite } : {} }),
    )
    setJwt(r.token)
    return 'ok'
  } catch {
    return 'offline'
  }
}
