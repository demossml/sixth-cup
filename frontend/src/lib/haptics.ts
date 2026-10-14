const KEY = 'sc_vibrate'
export function vibrationEnabled(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
export function setVibrationEnabled(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* */ }
}
export function hapticSyncOk() {
  if (!vibrationEnabled()) return
  if (typeof window === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  try { navigator.vibrate?.(12) } catch { /* */ }
}
