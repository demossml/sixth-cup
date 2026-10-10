import { useEffect, useState } from 'react'
import { adminFetch } from '../../api/client'
import { formatTs } from '../../lib/format'
import { PageHeader } from '../../ui/PageHeader'

export function SystemPage() {
  const [logs, setLogs] = useState<string[]>([])
  const [audit, setAudit] = useState<any[]>([])
  const [err, setErr] = useState('')
  const [confirmWord, setConfirmWord] = useState('')
  const [msg, setMsg] = useState('')

  function load() {
    adminFetch<{ lines: string[] }>('/logs?lines=100')
      .then((r) => setLogs(r.lines))
      .catch((e) => setErr(e.message))
    adminFetch<{ items: any[] }>('/audit?limit=50')
      .then((r) => setAudit(r.items))
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  async function doReset(mode: 'loyalty' | 'catalog' | 'full') {
    if (confirmWord !== 'RESET') {
      setErr('Введите слово RESET для подтверждения')
      return
    }
    try {
      await adminFetch('/reset', { method: 'POST', body: JSON.stringify({ mode, confirm: true }) })
      setMsg(`Reset ${mode} OK`)
      setConfirmWord('')
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Система" subtitle="Логи, audit, опасная зона" />
      {err ? <p className="text-red-600 text-sm">{err}</p> : null}
      {msg ? <p className="text-emerald-700 text-sm">{msg}</p> : null}
      <div className="rounded-2xl border border-line bg-slate-900 text-slate-100 p-3 text-xs font-mono max-h-80 overflow-auto">
        {logs.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div className="rounded-2xl border border-line bg-white p-4">
        <h2 className="font-semibold mb-2 text-sm">Audit</h2>
        {!audit.length ? (
          <p className="text-sm text-ink-secondary">Пусто</p>
        ) : (
          <ul className="text-xs space-y-1 max-h-48 overflow-auto">
            {audit.map((a) => (
              <li key={a.id}>
                {formatTs(a.at)} · {a.method} {a.path}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 space-y-2">
        <h2 className="font-semibold text-red-800">Опасная зона</h2>
        <p className="text-xs text-red-700">
          На проде reset закрыт, если ADMIN_ALLOW_RESET≠1. Подтверждение словом RESET.
        </p>
        <input
          className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm"
          placeholder="RESET"
          value={confirmWord}
          onChange={(e) => setConfirmWord(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-xl bg-red-700 text-white px-3 py-2 text-sm" onClick={() => doReset('loyalty')}>
            Reset loyalty
          </button>
          <button type="button" className="rounded-xl bg-red-700 text-white px-3 py-2 text-sm" onClick={() => doReset('catalog')}>
            Reset catalog
          </button>
          <button type="button" className="rounded-xl bg-red-900 text-white px-3 py-2 text-sm" onClick={() => doReset('full')}>
            Reset full
          </button>
        </div>
      </div>
    </div>
  )
}
