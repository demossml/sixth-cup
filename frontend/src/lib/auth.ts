import { api, setJwt, unwrap } from '../api'
import { getAccount, saveAccount } from './db'

export async function bootstrapCustomer(inviteCode?: string) {
  const existing = await getAccount()
  if (existing) {
    setJwt(existing.jwt)
    return existing
  }

  const result = await unwrap(api.api.auth.guest.$post({
    json: inviteCode ? { inviteCode } : {},
  }))

  const account = {
    userId: result.userId,
    jwt: result.token,
    createdAt: Date.now(),
  }
  await saveAccount(account)
  setJwt(account.jwt)
  return account
}

export async function useRecoveryToken(token: string) {
  const result = await unwrap(api.api.auth.recovery.use.$post({ json: { token } }))
  const account = { userId: result.userId, jwt: result.token, createdAt: Date.now() }
  await saveAccount(account)
  setJwt(account.jwt)
  localStorage.removeItem('sc-recovery-banner-seen')
  return account
}

export async function createRecoveryToken() {
  const result = await unwrap(api.api.auth.recovery.create.$post({ json: {} }))
  return result.token
}
