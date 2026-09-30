export type SmsSendParams = {
  phone: string
  message: string
}

export type SmsSendResult = {
  ok: true
  providerId?: string
}

export interface SmsProvider {
  readonly name: string
  send(params: SmsSendParams): Promise<SmsSendResult>
}
