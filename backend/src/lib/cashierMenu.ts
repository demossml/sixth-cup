/**
 * Настройки меню кассы — по каждой точке отдельно.
 *
 * Ключи в app_settings:
 *   cashier_menu:<storeUuid>  — настройка конкретной кассы (основной путь)
 *   cashier_menu              — общая настройка-наследство (до разделения по точкам)
 *
 * Значения: showAllTab (bool), hiddenGroups (имена групп), order (имена в нужном порядке).
 * Порядок не задан — берётся categories.sort_order.
 */
import { db } from '../db'

const GLOBAL_KEY = 'cashier_menu'
const storeKey = (storeUuid: string) => `cashier_menu:${storeUuid}`

export type CashierMenu = {
  /** Вкладка «Всё» на терминале. По умолчанию включена — как было до настройки. */
  showAllTab: boolean
  /** Имена групп, которые на кассе не показываем (товары остаются в каталоге). */
  hiddenGroups: string[]
  /** Порядок групп для этой точки. Пусто — порядок из categories.sort_order. */
  order: string[]
}

const DEFAULTS: CashierMenu = { showAllTab: true, hiddenGroups: [], order: [] }

const clean = (list: unknown, limit = 200): string[] =>
  Array.isArray(list) ? list.map((s) => String(s).trim()).filter(Boolean).slice(0, limit) : []

function readKey(key: string): CashierMenu | null {
  let raw: string | null = null
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string } | undefined
    raw = row?.value ?? null
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CashierMenu>
    return {
      showAllTab: parsed.showAllTab !== false,
      hiddenGroups: clean(parsed.hiddenGroups),
      order: clean(parsed.order),
    }
  } catch {
    return null
  }
}

/** Настройка точки; если её нет — общая (наследство), иначе значения по умолчанию. */
export function getCashierMenu(storeUuid?: string | null): CashierMenu {
  if (storeUuid) {
    const own = readKey(storeKey(storeUuid))
    if (own) return own
  }
  return readKey(GLOBAL_KEY) ?? { ...DEFAULTS }
}

/** Есть ли у точки собственная настройка (в админке показываем «своя» / «как у всех»). */
export function hasStoreMenu(storeUuid: string): boolean {
  return readKey(storeKey(storeUuid)) != null
}

export function setCashierMenu(patch: Partial<CashierMenu>, storeUuid?: string | null): CashierMenu {
  const key = storeUuid ? storeKey(storeUuid) : GLOBAL_KEY
  const current = readKey(key) ?? (storeUuid ? getCashierMenu(null) : { ...DEFAULTS })
  const next: CashierMenu = { ...current }
  if (patch.showAllTab !== undefined) next.showAllTab = !!patch.showAllTab
  if (patch.hiddenGroups !== undefined) next.hiddenGroups = clean(patch.hiddenGroups)
  if (patch.order !== undefined) next.order = clean(patch.order)
  db.prepare(
    `INSERT INTO app_settings(key, value, updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).run(key, JSON.stringify(next), Date.now())
  return next
}

/** Сброс точки на общую настройку (удаляем собственный ключ). */
export function resetStoreMenu(storeUuid: string): CashierMenu {
  db.prepare('DELETE FROM app_settings WHERE key=?').run(storeKey(storeUuid))
  return getCashierMenu(storeUuid)
}
