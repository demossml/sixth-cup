/**
 * Настройки предзаказа — по каждой точке отдельно.
 *
 * Ключи в app_settings:
 *   preorder:<storeId>  — настройка конкретной точки (основной путь)
 *   preorder            — общая настройка-наследство
 *
 * Смысл полей:
 *   prepMinutes       — сколько примерно готовится заказ (база для ETA);
 *   noShowBanHours    — на сколько часов банить гостя, который не забрал и не оплатил заказ;
 *   pickupGraceMinutes— сколько ждать после готовности, прежде чем считать «не забрал»;
 *   autoReady         — самому переводить заказ в «готов» по ETA (кассир может подтвердить раньше).
 */
import { db } from '../db'

const GLOBAL_KEY = 'preorder'
const storeKey = (storeId: number) => `preorder:${storeId}`

export type PreorderSettings = {
  prepMinutes: number
  noShowBanHours: number
  pickupGraceMinutes: number
  autoReady: boolean
}

export const PREORDER_DEFAULTS: PreorderSettings = {
  prepMinutes: 7,
  noShowBanHours: 24,
  pickupGraceMinutes: 60,
  autoReady: true,
}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalize(raw: Partial<PreorderSettings> | null): PreorderSettings {
  return {
    prepMinutes: clampInt(raw?.prepMinutes, 1, 120, PREORDER_DEFAULTS.prepMinutes),
    noShowBanHours: clampInt(raw?.noShowBanHours, 0, 720, PREORDER_DEFAULTS.noShowBanHours),
    pickupGraceMinutes: clampInt(raw?.pickupGraceMinutes, 0, 720, PREORDER_DEFAULTS.pickupGraceMinutes),
    autoReady: raw?.autoReady === undefined ? PREORDER_DEFAULTS.autoReady : raw.autoReady !== false,
  }
}

function readKey(key: string): Partial<PreorderSettings> | null {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string } | undefined
    if (!row?.value) return null
    const parsed = JSON.parse(row.value) as Partial<PreorderSettings>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** Настройки точки: своя → общая → дефолты. */
export function getPreorderSettings(storeId?: number | null): PreorderSettings {
  const own = storeId != null && Number.isFinite(storeId) ? readKey(storeKey(storeId)) : null
  if (own) return normalize(own)
  return normalize(readKey(GLOBAL_KEY))
}

export function hasStorePreorderSettings(storeId: number): boolean {
  return readKey(storeKey(storeId)) !== null
}

/** Частичное обновление: undefined = не трогать. */
export function setPreorderSettings(storeId: number | null, patch: Partial<PreorderSettings>): PreorderSettings {
  const key = storeId != null && Number.isFinite(storeId) ? storeKey(storeId) : GLOBAL_KEY
  const current = storeId != null ? getPreorderSettings(storeId) : normalize(readKey(GLOBAL_KEY))
  const next = normalize({ ...current, ...patch })
  db.prepare('INSERT OR REPLACE INTO app_settings(key, value, updated_at) VALUES(?,?,?)')
    .run(key, JSON.stringify(next), Date.now())
  return next
}
