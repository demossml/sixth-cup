import { useEffect, useState } from 'react'
import { adminFetch } from '../../api/client'
import { formatTs } from '../../lib/format'
import { PageHeader } from '../../ui/PageHeader'
import { Badge } from '../../ui/Badge'

export function EvotorPage() {
  const [health, setHealth] = useState<any>(null)
  const [stores, setStores] = useState<any[]>([])
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  function load() {
    adminFetch('/evotor/health').then(setHealth).catch((e) => setErr(e.message))
    adminFetch<{ stores: any[] }>('/evotor/stores').then((r) => setStores(r.stores ?? (r as any))).catch(() => {})
  }

  useEffect(() => {
    load()
  }, [])

  async function toggleSync(uuid: string, enabled: boolean) {
    try {
      await adminFetch(`/evotor/stores/${encodeURIComponent(uuid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ syncEnabled: enabled }),
      })
      setMsg('Сохранено')
      load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function run(path: string) {
    try {
      await adminFetch(path, { method: 'POST', body: '{}' })
      setMsg('OK: ' + path)
      load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const list = health?.stores ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Касса Эвотор"
        actions={
          <div className="flex gap-2">
            <button type="button" className="rounded-xl border px-3 py-2 text-sm bg-white" onClick={() => run('/evotor/poll')}>
              Poll
            </button>
            <button type="button" className="rounded-xl border px-3 py-2 text-sm bg-white" onClick={() => run('/evotor/sync')}>
              Sync
            </button>
          </div>
        }
      />
      {err ? <p className="text-red-600 text-sm">{err}</p> : null}
      {msg ? <p className="text-emerald-700 text-sm">{msg}</p> : null}
      <div className="rounded-2xl border border-line bg-white divide-y divide-line">
        {list.map((s: any) => (
          <div key={s.storeUuid} className="p-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="text-ink-tertiary text-xs">{s.storeUuid.slice(0, 8)}… · poll {formatTs(s.lastPollAt)} · outbox {s.outboxPending}</div>
            </div>
            <div className="flex items-center gap-3">
              <Badge level={s.level}>{s.level}</Badge>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!s.syncEnabled} onChange={(e) => toggleSync(s.storeUuid, e.target.checked)} />
                sync
              </label>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-tertiary">wipe-catalog — только в Системе / Legacy с подтверждением.</p>
    </div>
  )
}
