/**
 * AI provider settings: env defaults + optional overrides in app_settings (admin UI).
 * Keys are never returned in full to the client — only masked status.
 */
import { db } from '../db'
import { config } from '../config'

export const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'] as const
export type DeepseekModel = (typeof DEEPSEEK_MODELS)[number]

const KEYS = {
  enabled: 'ai_enabled',
  model: 'ai_model',
  apiKey: 'ai_api_key',
  baseUrl: 'ai_base_url',
} as const

function getRaw(key: string): string | null {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string } | undefined
    return row?.value ?? null
  } catch {
    return null
  }
}

function setRaw(key: string, value: string) {
  db.prepare(
    `INSERT INTO app_settings(key, value, updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).run(key, value, Date.now())
}

export function resolveAiConfig() {
  const fromDbEnabled = getRaw(KEYS.enabled)
  const enabled =
    fromDbEnabled === '1' ? true : fromDbEnabled === '0' ? false : !!config.aiAssistant

  const modelRaw = (getRaw(KEYS.model) || config.aiModel || 'deepseek-chat').trim()
  const model = (DEEPSEEK_MODELS as readonly string[]).includes(modelRaw)
    ? modelRaw
    : 'deepseek-chat'

  const apiKey = (getRaw(KEYS.apiKey) || config.aiApiKey || '').trim()
  const baseUrl = (
    getRaw(KEYS.baseUrl) ||
    config.aiBaseUrl ||
    'https://api.deepseek.com'
  )
    .trim()
    .replace(/\/$/, '')

  return { enabled, model, apiKey, baseUrl, hasKey: apiKey.length > 0 }
}

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

export function getAiSettingsPublic() {
  const c = resolveAiConfig()
  return {
    enabled: c.enabled,
    model: c.model,
    baseUrl: c.baseUrl,
    hasKey: c.hasKey,
    keyHint: c.hasKey ? maskKey(c.apiKey) : '',
    models: [...DEEPSEEK_MODELS],
    provider: 'deepseek' as const,
    ready: c.enabled && c.hasKey,
  }
}

export function saveAiSettings(input: {
  enabled?: boolean
  model?: string
  apiKey?: string | null
  clearKey?: boolean
}) {
  if (typeof input.enabled === 'boolean') {
    setRaw(KEYS.enabled, input.enabled ? '1' : '0')
  }
  if (input.model) {
    const m = input.model.trim()
    if (!(DEEPSEEK_MODELS as readonly string[]).includes(m)) {
      throw new Error('Only DeepSeek models are allowed')
    }
    setRaw(KEYS.model, m)
    setRaw(KEYS.baseUrl, 'https://api.deepseek.com')
  }
  if (input.clearKey) {
    setRaw(KEYS.apiKey, '')
  } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    setRaw(KEYS.apiKey, input.apiKey.trim())
  }
  return getAiSettingsPublic()
}
