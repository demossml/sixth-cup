import { api, getJwt, setJwt, unwrap } from '../api'

/** Anonymous account without phone/SMS. */
export async function ensureGuest(): Promise<'ok' | 'offline'> {
  if (getJwt()) return 'ok'
  const invite = localStorage.getItem('sc-invite') ?? undefined
  try {
    const r = await unwrap(
      api.api.auth.guest.$post({ json: invite ? { inviteCode: invite } : {} }),
    ) as { token: string }
    setJwt(r.token)
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
    return true
  } catch {
    return false
  }
}
