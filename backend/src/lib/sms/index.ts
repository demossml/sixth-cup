import { config } from '../../config'
import { MockSmsProvider } from './mock'
import { SmsAeroProvider } from './smsaero'
import type { SmsProvider } from './types'

export type { SmsProvider } from './types'
export { getMockLastMessage, clearMockMessages } from './mock'

export function getSmsProvider(): SmsProvider {
  const name = config.smsProvider
  if (name === 'smsaero') {
    if (config.isDev && !config.smsAeroApiKey) {
      console.warn('[sms] SMS_PROVIDER=smsaero but no key — falling back to mock in dev')
      return new MockSmsProvider()
    }
    return new SmsAeroProvider()
  }
  if (name === 'mock' || config.isDev) {
    return new MockSmsProvider()
  }
  // production unknown provider
  console.error('[sms] unknown SMS_PROVIDER', name)
  return new MockSmsProvider()
}
