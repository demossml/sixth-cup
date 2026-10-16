import { createContext, useCallback, useContext, useEffect, useState, useRef, type ReactNode } from 'react'
import { getJwt } from '../api'
import { computeBest, syncCustomer, type Best } from './customer'
import { kvGet } from './db'
import { loadDirectory, refreshDirectory } from './directory'
import type { Directory, Me } from './types'

type Ctx = {
  dir: Directory | null
  me: Me | null
  best: Best | null
  syncing: boolean
  lastSync: number
  sync: () => Promise<string>
  reload: () => Promise<void>
}
const AppCtx = createContext<Ctx>(null!)
export const useApp = () => useContext(AppCtx)

/** Stable fingerprint of Me fields that affect card/UI. */
function meFingerprint(m: Me | null): string | null {
  if (!m) return null
  return JSON.stringify({
    id: m.id,
    cardId: m.cardId,
    cardCode: m.cardCode,
    nickname: m.nickname,
    inviteCode: m.inviteCode,
    cashbackBalance: m.cashbackBalance,
    cupsTowardFree: m.cupsTowardFree ?? null,
    freeAvailable: m.freeAvailable ?? null,
    cupsForFree: m.cupsForFree ?? null,
    fromFriendsRub: m.fromFriendsRub ?? null,
    fromFriendsKopecks: m.fromFriendsKopecks ?? null,
    friendsCount: m.friendsCount ?? null,
    vouchers: m.vouchers ?? null,
  })
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [dir, setDir] = useState<Directory | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [best, setBest] = useState<Best | null>(null)
  const [syncing, setSyncing] = useState(false)
  const syncFlight = useRef<Promise<string> | null>(null)
  const [lastSync, setLastSync] = useState(Number(localStorage.getItem('sc-last-sync') ?? 0))
  const dirAt = useRef<number | null>(null)
  const meKey = useRef<string | null>(null)

  const reload = useCallback(async () => {
    const d = (await loadDirectory()) ?? null
    const m = (await kvGet<Me>('me')) ?? null

    let dirChanged = false
    let meChanged = false

    const nextDirAt = d?.generatedAt ?? null
    if (nextDirAt !== dirAt.current) {
      dirAt.current = nextDirAt
      setDir(d)
      dirChanged = true
    }

    const nextMeKey = meFingerprint(m)
    if (nextMeKey !== meKey.current) {
      meKey.current = nextMeKey
      setMe(m)
      meChanged = true
    }

    if (dirChanged || meChanged) {
      // Use latest objects we just decided to publish (or current state if only one side changed).
      const dirForBest = dirChanged ? d : d // d is always the freshly loaded catalog
      const meForBest = meChanged ? m : m
      setBest(dirForBest && meForBest ? await computeBest(dirForBest, meForBest) : null)
    }

    setLastSync(Number(localStorage.getItem('sc-last-sync') ?? 0))
  }, [])

  const sync = useCallback(async () => {
    if (syncFlight.current) return syncFlight.current
    const task = (async () => {
      try {
        if (!getJwt()) { await refreshDirectory(); await reload(); return 'noauth' }
        setSyncing(true)
        const r = await syncCustomer(); await reload(); return r
      } finally { setSyncing(false); syncFlight.current = null }
    })()
    syncFlight.current = task
    return task
  }, [reload])

  useEffect(() => {
    reload().then(() => sync())
    const run = () => { void sync() }
    const onVisible = () => { if (!document.hidden) run() }
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(run, 60_000)
    return () => {
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [reload, sync])

  return <AppCtx.Provider value={{ dir, me, best, syncing, lastSync, sync, reload }}>{children}</AppCtx.Provider>
}
