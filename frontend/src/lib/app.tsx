import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getJwt } from '../api'
import { computeBest, syncCustomer, type Best } from './customer'
import { kvGet } from './db'
import { loadDirectory, refreshDirectory } from './directory'
import type { Directory, Me, ReferralStats } from './types'

type Ctx = {
  dir: Directory | null
  me: Me | null
  referrals: ReferralStats
  best: Best | null
  syncing: boolean
  lastSync: number
  sync: () => Promise<string>
  reload: () => Promise<void>
}
const AppCtx = createContext<Ctx>(null!)
export const useApp = () => useContext(AppCtx)

export function AppProvider({ children }: { children: ReactNode }) {
  const [dir, setDir] = useState<Directory | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [referrals, setReferrals] = useState<ReferralStats>({ friendCashbackTotal: 0, friendCount: 0 })
  const [best, setBest] = useState<Best | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(Number(localStorage.getItem('sc-last-sync') ?? 0))

  const reload = useCallback(async () => {
    const d = (await loadDirectory()) ?? null
    const m = (await kvGet<Me>('me')) ?? null
    const r = (await kvGet<ReferralStats>('referrals')) ?? { friendCashbackTotal: 0, friendCount: 0 }
    setDir(d)
    setMe(m)
    setReferrals(r)
    setBest(d && m ? await computeBest(d, m) : null)
    setLastSync(Number(localStorage.getItem('sc-last-sync') ?? 0))
  }, [])

  const sync = useCallback(async () => {
    if (!getJwt()) { await refreshDirectory(); await reload(); return 'noauth' }
    setSyncing(true)
    const r = await syncCustomer()
    setSyncing(false)
    await reload()
    return r
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

  return <AppCtx.Provider value={{ dir, me, referrals, best, syncing, lastSync, sync, reload }}>{children}</AppCtx.Provider>
}
