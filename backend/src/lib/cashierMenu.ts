/**
 * Настройки меню кассы: как терминал рисует вкладки групп.
 *
 * Порядок групп берётся из `categories.sort_order` (админка → Меню → Группы → «Порядок»),
 * а этот модуль отвечает только за то, что нельзя выразить полем категории:
 * показывать ли вкладку «Всё» и скрытые на кассе группы.
 */
import { db } from '../db'

const KEY = 'cashier_menu'

export type CashierMenu = {
  /** Вкладка «Всё» на терминале. По умолчанию включена — как было до настройки. */
  showAllTab: boolean
  /** Имена групп, которые на кассе не показываем (порядок при этом остаётся в categories). */
  hiddenGroups: string[]
}

const DEFAULTS: CashierMenu = { showAllTab: true, hiddenGroups: [] }

function readRaw(): string | null {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(KEY) as { value: string } | undefined
    return row?.value ?? null
  } catch {
    return null
  }
}

export function getCashierMenu(): CashierMenu {
  const raw = readRaw()
  if (!raw) return { ...DEFAULTS }
  try {
    const parsed = JSON.parse(raw) as Partial<CashierMenu>
    return {
      showAllTab: parsed.showAllTab !== false,
      hiddenGroups: Array.isArray(parsed.hiddenGroups)
        ? parsed.hiddenGroups.map((s) => String(s).trim()).filter(Boolean).slice(0, 200)
        : [],
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setCashierMenu(patch: Partial<CashierMenu>): CashierMenu {
  const next: CashierMenu = { ...getCashierMenu() }
  if (patch.showAllTab !== undefined) next.showAllTab = !!patch.showAllTab
  if (patch.hiddenGroups !== undefined) {
    next.hiddenGroups = patch.hiddenGroups.map((s) => String(s).trim()).filter(Boolean).slice(0, 200)
  }
  db.prepare(
    `INSERT INTO app_settings(key, value, updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).run(KEY, JSON.stringify(next), Date.now())
  return next
}
