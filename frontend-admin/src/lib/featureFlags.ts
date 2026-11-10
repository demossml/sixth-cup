/**
 * Флаги функций админки (сборка Vite).
 *
 * `VITE_MENU_LAYOUT_V2=1` включает новый редактор «Макета меню» (этапы 2-5 аудита).
 * Пока флаг объявлен, но ничего не переключает: v1-холст остаётся рабочим.
 */
const on = (value: unknown): boolean => String(value ?? '') === '1'

export const MENU_LAYOUT_V2 = on((import.meta as { env?: Record<string, unknown> }).env?.VITE_MENU_LAYOUT_V2)
