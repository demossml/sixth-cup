/**
 * Рекомендации на кассе (upsell) — настройка по каждой точке.
 *
 * Ключи в app_settings:
 *   cashier_upsell:<storeUuid>  — настройка конкретной точки (основной путь)
 *   cashier_upsell              — общая настройка-наследство (как у cashier_menu)
 *
 * По умолчанию выключено: пока владелец явно не включил блок, каталог отдаёт
 * пустые `upsell` / `upsellDefault` — старые кассы тоже молчат.
 *
 * Значение:
 *   enabled           — главный рубильник точки;
 *   defaultProductIds — «к любому заказу», порядок = порядок на кассе;
 *   byProductId       — «рекомендовать вместе с этим товаром» (опционально).
 *
 * Добавки/молоко/схемы и «Фокус» (#focus) этим флагом не управляются.
 */
import { db } from '../db'

const GLOBAL_KEY = 'cashier_upsell'
const storeKey = (storeUuid: string) => `cashier_upsell:${storeUuid}`

/** Потолок списка «к любому заказу»: больше на кассе не читается. */
export const UPSELL_DEFAULTS_MAX = 12
/** Потолок «с этим товаром»: плитка кассы — 6 штук. */
export const UPSELL_PER_PRODUCT_MAX = 6

export type CashierUpsell = {
  /** Показывать рекомендации на кассе. По умолчанию false. */
  enabled: boolean
  /** Товары «к любому заказу» в нужном порядке. */
  defaultProductIds: number[]
  /** Товары «рекомендовать вместе с этим»: productId → список id. */
  byProductId: Record<string, number[]>
}

const DEFAULTS: CashierUpsell = { enabled: false, defaultProductIds: [], byProductId: {} }

const cleanIds = (value: unknown, limit: number): number[] => {
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const raw of value) {
    const id = Number(raw)
    if (!Number.isInteger(id) || id <= 0 || out.includes(id)) continue
    out.push(id)
    if (out.length >= limit) break
  }
  return out
}

const cleanMap = (value: unknown): Record<string, number[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number[]> = {}
  for (const [key, list] of Object.entries(value as Record<string, unknown>)) {
    const id = Number(key)
    if (!Number.isInteger(id) || id <= 0) continue
    const ids = cleanIds(list, UPSELL_PER_PRODUCT_MAX)
    if (ids.length) out[String(id)] = ids
  }
  return out
}

function readKey(key: string): CashierUpsell | null {
  let raw: string | null = null
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string } | undefined
    raw = row?.value ?? null
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CashierUpsell>
    return {
      enabled: parsed?.enabled === true,
      defaultProductIds: cleanIds(parsed?.defaultProductIds, UPSELL_DEFAULTS_MAX),
      byProductId: cleanMap(parsed?.byProductId),
    }
  } catch {
    // Битый JSON не должен ронять каталог: работаем как с заводской настройкой.
    return null
  }
}

/** Настройка точки; своей нет — общая, иначе выключено. */
export function getCashierUpsell(storeUuid?: string | null): CashierUpsell {
  if (storeUuid) {
    const own = readKey(storeKey(storeUuid))
    if (own) return own
  }
  return readKey(GLOBAL_KEY) ?? { ...DEFAULTS, byProductId: {} }
}

/** Есть ли у точки собственная настройка (в админке «своя» / «как у всех»). */
export function hasStoreUpsell(storeUuid: string): boolean {
  return readKey(storeKey(storeUuid)) != null
}

export function setCashierUpsell(patch: Partial<CashierUpsell>, storeUuid?: string | null): CashierUpsell {
  const key = storeUuid ? storeKey(storeUuid) : GLOBAL_KEY
  const current = readKey(key) ?? (storeUuid ? getCashierUpsell(null) : { ...DEFAULTS, byProductId: {} })
  const next: CashierUpsell = {
    enabled: patch.enabled !== undefined ? !!patch.enabled : current.enabled,
    defaultProductIds: patch.defaultProductIds !== undefined
      ? cleanIds(patch.defaultProductIds, UPSELL_DEFAULTS_MAX)
      : current.defaultProductIds,
    byProductId: patch.byProductId !== undefined ? cleanMap(patch.byProductId) : current.byProductId,
  }
  db.prepare(
    `INSERT INTO app_settings(key, value, updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).run(key, JSON.stringify(next), Date.now())
  return next
}

/** Сброс точки на общую настройку (удаляем собственный ключ). */
export function resetCashierUpsell(storeUuid: string): CashierUpsell {
  db.prepare('DELETE FROM app_settings WHERE key=?').run(storeKey(storeUuid))
  return getCashierUpsell(storeUuid)
}
