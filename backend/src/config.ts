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
  cupsForFree: 5,
  referralCashbackPercent: 3,
  currency: 'RUB',
  maxVouchersInCard: 5,
  /** max product image upload bytes */
  maxUploadBytes: 2 * 1024 * 1024,
}

if (!isDev && (config.jwtSecret === 'dev-secret-change-me' || config.adminToken === 'dev-admin')) {
  throw new Error('Set JWT_SECRET and ADMIN_TOKEN in production!')
}

/** Allowed tax_regime values */
export const TAX_REGIMES = ['usn_income', 'usn_income_expense', 'osn', 'patent'] as const
export type TaxRegime = (typeof TAX_REGIMES)[number]
