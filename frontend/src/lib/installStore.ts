import { useEffect, useState } from 'react'
import { dismissInstallBanner, isDismissed, isIos, isStandalone, type BeforeInstallPromptEvent } from './install'

/**
 * Событие beforeinstallprompt приходит один раз, поэтому ловим его на уровне модуля
 * (импортируется в main.tsx), а баннеры подписываются на хранилище.
 */
let deferred: BeforeInstallPromptEvent | null = null
const subs = new Set<() => void>()
const notify = () => subs.forEach((f) => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => { deferred = null; notify() })
}

export function useInstall() {
  const [, tick] = useState(0)
  const [dismissed, setDismissed] = useState(() => { try { return isDismissed() } catch { return false } })
  useEffect(() => {
    const f = () => tick((x) => x + 1)
    subs.add(f)
    return () => { subs.delete(f) }
  }, [])
  const standalone = typeof window !== 'undefined' && isStandalone()
  const ios = typeof navigator !== 'undefined' && isIos()
  const canPrompt = !!deferred
  const visible = !standalone && !dismissed && (canPrompt || ios)

  async function install(): Promise<void> {
    const d = deferred
    if (!d) return
    try {
      await d.prompt()
      const { outcome } = await d.userChoice
      if (outcome !== 'accepted') { dismissInstallBanner(); setDismissed(true) }
    } catch {
      dismissInstallBanner(); setDismissed(true)
    } finally {
      deferred = null
      notify()
    }
  }
  function later() { dismissInstallBanner(); setDismissed(true) }

  return { visible, canPrompt, ios, install, later }
}
