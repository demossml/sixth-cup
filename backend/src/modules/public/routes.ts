import { Hono } from 'hono'
import { db } from '../../db'
import { config } from '../../config'

function setting(key: string, fallback: string): string {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value?: string } | undefined
    if (row?.value && String(row.value).trim()) return String(row.value)
  } catch { /* */ }
  return fallback
}

const fallbacks = {
  legal_loyalty: 'Каждый шестой подходящий напиток — по правилам программы. Начисления делает сервер после покупки на кассе. Карта выдаётся без номера телефона.',
  legal_privacy: 'Мы храним идентификатор карты, историю покупок по программе и служебные данные синхронизации. Телефон для входа не требуется.',
  seller_info: 'Реквизиты продавца уточняйте в кофейне 6.7 Coffee или у администратора сети.',
  home_banner: '',
  install_hint: 'Добавьте 6.7 Coffee на экран Домой для быстрого QR у кассы.',
}

export const publicRoutes = new Hono().get('/content', (c) =>
  c.json({
    legal_loyalty: setting('legal_loyalty', fallbacks.legal_loyalty),
    legal_privacy: setting('legal_privacy', fallbacks.legal_privacy),
    seller_info: setting('seller_info', fallbacks.seller_info),
    home_banner: setting('home_banner', fallbacks.home_banner),
    install_hint: setting('install_hint', fallbacks.install_hint),
    pushEnabled: Boolean((config as { pushEnabled?: boolean }).pushEnabled),
  }),
)
