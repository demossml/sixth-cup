import { useApi } from './useApi'
import type { EvotorStore, Health } from './types'

/** Tills we actually work with (sync enabled). Read from our own database, so it works even when Evotor Cloud is unreachable. */
export function useSyncStores(): { stores: EvotorStore[]; loading: boolean } {
  const { data, loading } = useApi<Health>('/evotor/health')
  const stores = (data?.stores ?? []).filter((s) => s.enabled).map((s) => ({ uuid: s.uuid, name: s.name, syncEnabled: true }))
  return { stores, loading }
}
