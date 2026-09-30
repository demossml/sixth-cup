import { config } from '../../config'
import { bad } from '../errors'
import type { SmsProvider, SmsSendParams, SmsSendResult } from './types'

/**
 * Official SMS Aero API v2: https://smsaero.ru/integration/documentation/api/
 * Auth: Basic base64(email:api_key)
 */
export class SmsAeroProvider implements SmsProvider {
  readonly name = 'smsaero'

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const email = config.smsAeroEmail
    const apiKey = config.smsAeroApiKey
    if (!email || !apiKey) {
      throw bad('SMS-провайдер не настроен', 503)
    }

    const number = params.phone.replace(/\D/g, '').replace(/^8(\d{10})$/, '7$1')
    const auth = Buffer.from(`${email}:${apiKey}`).toString('base64')

    let res: Response
    try {
      res = await fetch('https://gate.smsaero.ru/v2/sms/send', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          number,
          text: params.message,
          sign: config.smsAeroSender,
        }),
      })
    } catch {
      console.error('[sms] smsaero network error', maskPhone(params.phone))
      throw bad('Не удалось отправить код. Попробуйте позже.', 502)
    }

    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean
      message?: string
      data?: { id?: number }
    }

    if (!res.ok || body.success === false) {
      console.error('[sms] smsaero send failed', res.status, maskPhone(params.phone), body.message ?? '')
      throw bad('Не удалось отправить код. Попробуйте позже.', 502)
    }

    console.log('[sms] smsaero send success', maskPhone(params.phone))
    return { ok: true, providerId: body.data?.id != null ? String(body.data.id) : undefined }
  }
}

function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length < 4) return '****'
  return `+${d.slice(0, 1)}******${d.slice(-4)}`
}
