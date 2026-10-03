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
    // Hono RPC types may not yet include guest body fields / resumed — cast for tsc
    const r = await unwrap(
      api.api.auth.guest.$post({
        json: {
          ...(invite ? { inviteCode: invite } : {}),
          clientNonce,
        },
      }) as never,
    ) as { token: string; resumed?: boolean }
    setJwt(r.token)
    return 'ok'
  } catch {
    return 'offline'
  }
}
