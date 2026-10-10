import { useEffect, useState } from 'react'
import { adminFetch } from '../../api/client'
import { formatTs } from '../../lib/format'
import { PageHeader } from '../../ui/PageHeader'

export function SystemPage() {
  const [logs, setLogs] = useState<string[]>([])
  const [audit, setAudit] = useState<any[]>([])
  const [err, setErr] = useState('')

  function load() {
    adminFetch<{ lines: string[] }>('/logs?lines=80')
      .then((r) => setLogs(r.lines))
      .catch((e) => setErr(e.message))
    adminFetch<{ items: any[] }>('/audit?limit=40')
      .then((r) => setAudit(r.items))
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="space-y-4">
      <PageHeader title="Система" subtitle="Логи процесса и журнал действий админки" />
      {err ? <p className="text-red-600 text-sm">{err}</p> : null}
      <div className="rounded-2xl border border-line bg-slate-900 text-slate-100 p-3 text-xs font-mono max-h-80 overflow-auto">
        {logs.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div className="rounded-2xl border border-line bg-white p-4">
        <h2 className="font-semibold mb-2 text-sm">Audit</h2>
        {!audit.length ? (
          <p className="text-sm text-ink-secondary">Пока пусто (появится после PATCH товаров и т.п.)</p>
        ) : (
          <ul className="text-xs space-y-1">
            {audit.map((a) => (
              <li key={a.id}>
                {formatTs(a.at)} · {a.method} {a.path} · {a.entity}/{a.entityId}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-ink-tertiary">
        Опасная зона (reset / wipe): используйте Legacy при необходимости. На проде держите ADMIN_ALLOW_RESET=0.
      </p>
    </div>
  )
}
