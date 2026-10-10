import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminFetch } from '../../api/client'
import { formatMoneyRub, formatTs, shortId } from '../../lib/format'
import { PageHeader } from '../../ui/PageHeader'
import { Badge } from '../../ui/Badge'
import { EmptyState } from '../../ui/EmptyState'

type Dash = {
  sellCount: number
  sellFailed: number
  opsCount: number
  cupsSum: number
  outboxPending: number
  lastPollAt: number | null
  storesHealth: { storeUuid: string; name: string; syncEnabled: boolean; level: string; lastPollAt: number | null }[]
  recentOps: { storeUuid: string; docId: string; kind: string; cups: number; resultRub: number; createdAt: number; cardId?: string }[]
  problemDocs: { storeUuid: string; docId: string; status: string; lastError?: string }[]
}

export function TodayPage() {
  const [data, setData] = useState<Dash | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    const from = Date.now() - 24 * 3600_000
    adminFetch<Dash>(`/dashboard?from=${from}&to=${Date.now()}`)
      .then(setData)
      .catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    load()
    const onVis = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVis)
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(t)
    }
  }, [load])

  if (err) return <p className="text-red-600 text-sm">{err}</p>
  if (!data) return <p className="text-sm text-ink-secondary">Загрузка…</p>

  return (
    <div className="space-y-4">
      <PageHeader title="Сегодня" subtitle={`Последний poll: ${formatTs(data.lastPollAt)}`} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Чеки SELL', data.sellCount],
          ['Failed', data.sellFailed],
          ['Начисления', data.opsCount],
          ['Чашки', data.cupsSum],
        ].map(([label, v]) => (
          <div key={String(label)} className="rounded-2xl bg-white border border-line p-4">
            <div className="text-xs text-ink-secondary">{label}</div>
            <div className="text-2xl font-bold tabular-nums mt-1">{v}</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl bg-white border border-line p-4">
        <h2 className="font-semibold mb-2">Точки</h2>
        <div className="space-y-2">
          {data.storesHealth.map((s) => (
            <div key={s.storeUuid} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {s.name} {s.syncEnabled ? '' : <span className="text-ink-tertiary">(sync off)</span>}
              </span>
              <Badge level={s.level as any}>{s.level}</Badge>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-tertiary mt-2">Очередь outbox: {data.outboxPending}</p>
      </div>
      {data.problemDocs.length ? (
        <div className="rounded-2xl bg-white border border-line p-4">
          <h2 className="font-semibold mb-2">Проблемные документы</h2>
          <ul className="text-sm space-y-1">
            {data.problemDocs.map((d) => (
              <li key={d.storeUuid + d.docId}>
                <Link className="text-brand underline" to={`/operations/${encodeURIComponent(d.storeUuid)}/${encodeURIComponent(d.docId)}`}>
                  {shortId(d.docId)} · {d.status}
                </Link>
                {d.lastError ? <span className="text-ink-secondary"> — {d.lastError.slice(0, 80)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="rounded-2xl bg-white border border-line p-4">
        <h2 className="font-semibold mb-2">Последние начисления</h2>
        {!data.recentOps.length ? (
          <EmptyState title="Пока нет операций" description="После SELL с картой появятся здесь" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line">
                  <th className="py-2 pr-2">Время</th>
                  <th className="pr-2">Doc</th>
                  <th className="pr-2 text-right">Чашки</th>
                  <th className="text-right">₽</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOps.map((o) => (
                  <tr key={o.storeUuid + o.docId} className="border-b border-line/60">
                    <td className="py-2 pr-2 whitespace-nowrap">{formatTs(o.createdAt)}</td>
                    <td className="pr-2">
                      <Link className="text-brand" to={`/operations/${encodeURIComponent(o.storeUuid)}/${encodeURIComponent(o.docId)}`}>
                        {shortId(o.docId)}
                      </Link>
                    </td>
                    <td className="pr-2 text-right tabular-nums">{o.cups}</td>
                    <td className="text-right tabular-nums">{formatMoneyRub(o.resultRub)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
