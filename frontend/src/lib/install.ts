/** PWA install helpers — Android beforeinstallprompt, iOS manual Add to Home Screen */

const DISMISS_KEY = 'sc-install-dismissed'
const DISMISS_DAYS = 14

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari
  const nav = window.navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  return false
}

export function isIos(): boolean {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ desktop UA
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true
  return false
}

export function isDismissed(): boolean {
  const raw = localStorage.getItem(DISMISS_KEY)
  if (!raw) return false
  const until = Number(raw)
  if (!Number.isFinite(until)) return false
  if (Date.now() > until) {
    localStorage.removeItem(DISMISS_KEY)
    return false
  }
  return true
}

export function dismissInstallBanner() {
  localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86_400_000))
}

export function clearInstallDismiss() {
  localStorage.removeItem(DISMISS_KEY)
}
