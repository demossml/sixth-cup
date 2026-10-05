import { resolve } from 'node:path'

const isDev = process.env.NODE_ENV !== 'production'

export const config = {
  port: Number(process.env.PORT ?? 3000),
  isDev,
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  adminToken: process.env.ADMIN_TOKEN ?? 'dev-admin',
  dbPath: process.env.DB_PATH ?? './data/sixth-cup.db',
  keysPath: process.env.KEYS_PATH ?? './data/keys.json',
  uploadsDir: process.env.UPLOADS_DIR ?? resolve('./data/uploads'),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? '',
  adminHost: process.env.ADMIN_HOST ?? '',
  cupsForFree: 5,
  referralCashbackPercent: 3,
  currency: 'RUB',
  maxVouchersInCard: 5,
  maxUploadBytes: 2 * 1024 * 1024,

  /** Shared secret for Evotor cloud proxy (Authorization header). Empty = warn only. */
  evotorProxyToken: process.env.EVOTOR_PROXY_TOKEN ?? '',
  /** When 1, reject requests without valid proxy token on /api/devices/* */
  evotorProxyEnforce: process.env.EVOTOR_PROXY_ENFORCE === '1',

  /** mock | smsaero */
  smsProvider: (process.env.SMS_PROVIDER ?? (isDev ? 'mock' : 'smsaero')).toLowerCase(),
  smsAeroEmail: process.env.SMS_AERO_EMAIL ?? '',
  smsAeroApiKey: process.env.SMS_AERO_API_KEY ?? '',
  smsAeroSender: process.env.SMS_AERO_SENDER ?? '67Coffee',
  /** OTP message template; {code} replaced */
  smsOtpTemplate: process.env.SMS_OTP_TEMPLATE ?? 'Код 6.7 Coffee: {code}',
  otpTtlMs: 5 * 60_000,
  otpResendCooldownMs: 45_000,
  otpLength: 4,
}

if (!isDev && (config.jwtSecret === 'dev-secret-change-me' || config.adminToken === 'dev-admin')) {
  throw new Error('Set JWT_SECRET and ADMIN_TOKEN in production!')
}

/** Evotor Cloud (MASTER-TZ). Empty token = integration disabled until Phase 0. */
export const evotorConfig = {
  apiToken: process.env.EVOTOR_API_TOKEN ?? '',
  apiBaseUrl: (process.env.EVOTOR_API_BASE_URL ?? 'https://api.evotor.ru').replace(/\/$/, ''),
  pollIntervalSec: Number(process.env.EVOTOR_POLL_INTERVAL_SEC ?? 60),
  fastOverlapMin: Number(process.env.EVOTOR_FAST_OVERLAP_MIN ?? 15),
  hourlyWindowHours: Number(process.env.EVOTOR_HOURLY_WINDOW_HOURS ?? 48),
  dailyWindowDays: Number(process.env.EVOTOR_DAILY_WINDOW_DAYS ?? 7),
  silenceHours: Number(process.env.EVOTOR_SILENCE_HOURS ?? 8),
  appId: process.env.EVOTOR_APP_ID ?? '',
  webhookToken: process.env.EVOTOR_WEBHOOK_TOKEN ?? '',
  proxyUrl: process.env.EVOTOR_PROXY_URL ?? '',
  enabled: Boolean(process.env.EVOTOR_API_TOKEN?.trim()),
}

export const TAX_REGIMES = ['usn_income', 'usn_income_expense', 'osn', 'patent'] as const
export type TaxRegime = (typeof TAX_REGIMES)[number]
