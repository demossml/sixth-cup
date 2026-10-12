import { useEffect } from 'react'

type Lock = { release: () => Promise<void> }
type WakeNav = Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Lock> } }

/** Best-effort: не гасить экран, пока QR на виду (очередь у кассы). Повторно берёт замок при возврате во вкладку. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    let lock: Lock | null = null
    let alive = true
    const acquire = () => {
      const wl = (navigator as WakeNav).wakeLock
      if (!wl || document.hidden) return
      void wl.request('screen').then((l) => {
        if (alive) lock = l
        else void l.release().catch(() => {})
      }).catch(() => {})
    }
    acquire()
    const onVis = () => { if (!document.hidden) acquire() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVis)
      if (lock) void lock.release().catch(() => {})
    }
  }, [active])
}
