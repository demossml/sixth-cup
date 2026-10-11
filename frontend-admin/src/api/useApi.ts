import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './client'

export type ApiState<T> = { data: T | null; error: string; loading: boolean; reload: () => void }

/**
 * GET with loading / error / reload. Passing null skips the request.
 * refreshMs re-fetches quietly (no spinner) while the tab is visible.
 */
export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(path !== null)
  const [tick, setTick] = useState(0)
  const hasData = useRef(false)
  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    if (path === null) {
      setLoading(false)
      return
    }
    hasData.current = false
    setData(null)
  }, [path])

  useEffect(() => {
    if (path === null) return
    const ac = new AbortController()
    if (!hasData.current) setLoading(true)
    api<T>(path, { signal: ac.signal })
      .then((d) => {
        hasData.current = true
        setData(d)
        setError('')
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [path, tick])

  useEffect(() => {
    if (!opts.refreshMs || path === null) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1)
    }, opts.refreshMs)
    return () => clearInterval(id)
  }, [opts.refreshMs, path])

  return { data, error, loading, reload }
}
