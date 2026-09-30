import type { SmsProvider, SmsSendParams, SmsSendResult } from './types'

/** In-memory last messages for tests — never used as production transport. */
const lastByPhone = new Map<string, string>()

export function getMockLastMessage(phone: string): string | undefined {
  return lastByPhone.get(phone)
}

export function clearMockMessages() {
  lastByPhone.clear()
}

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock'

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    lastByPhone.set(params.phone, params.message)
    return { ok: true, providerId: 'mock' }
  }
}
