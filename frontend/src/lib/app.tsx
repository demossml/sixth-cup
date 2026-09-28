import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [dir, setDir] = useState<Directory | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [best, setBest] = useState<Best | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(Number(localStorage.getItem('sc-last-sync') ?? 0))

  const reload = useCallback(async () => {
    const d = (await loadDirectory()) ?? null
    const m = (await kvGet<Me>('me')) ?? null
    setDir(d)
    setMe(m)
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

  return <AppCtx.Provider value={{ dir, me, best, syncing, lastSync, sync, reload }}>{children}</AppCtx.Provider>
}
