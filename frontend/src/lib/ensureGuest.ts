
import { api, getJwt, setJwt, unwrap } from '../api'

function getOrCreateNonce(): string {
  let n = localStorage.getItem('sc-guest-nonce')
  if (!n || n.length < 16) {
    n = crypto.randomUUID() + '-' + crypto.randomUUID()
    localStorage.setItem('sc-guest-nonce', n)
  }
  return n
}

/** Один раз выдаёт карту без телефона. Повтор с тем же nonce не плодит аккаунты. */
export async function ensureGuest(): Promise<'ok' | 'offline'> {
  if (getJwt()) return 'ok'
  const invite = localStorage.getItem('sc-invite') ?? undefined
  const clientNonce = getOrCreateNonce()
  try {
    const r = await unwrap<{ token: string }>(
      api.api.auth.guest.$post({
        json: {
          ...(invite ? { inviteCode: invite } : {}),
          clientNonce,
        },
      }) as unknown as Promise<{ ok: boolean; json: () => Promise<{ token: string }> }>,
    )
    setJwt(r.token)
    return 'ok'
  } catch {
    return 'offline'
  }
}
