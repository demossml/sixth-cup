import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminFetch } from '../../api/client'
import { formatMoneyRub, formatTs, shortId } from '../../lib/format'
import { PageHeader } from '../../ui/PageHeader'
import { Badge } from '../../ui/Badge'
import { EmptyState } from '../../ui/EmptyState'

type Item = {
  storeUuid: string
  docId: string
  kind: string
  status: string
  closeDateMs: number
  lastError?: string
  cups?: number
  resultRub?: number
  cardCode?: string
}

export function OperationsPage() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [err, setErr] = useState('')

  function load() {
    const from = Date.now() - 30 * 24 * 3600_000
    const params = new URLSearchParams({ from: String(from), to: String(Date.now()), limit: '80' })
    if (q.trim()) params.set('q', q.trim())
    if (status) params.set('status', status)
    adminFetch<{ items: Item[] }>(`/operations?${params}`)
      .then((r) => setItems(r.items))
      .catch((e) => setErr(e.message))
  }

  useEffect(() => {
    load()
  }, [])

  async function exportCsv() {
    const from = Date.now() - 30 * 24 * 3600_000
    const text = await adminFetch<string>(`/operations.csv?from=${from}&to=${Date.now()}`)
    const blob = new Blob([text], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'operations.csv'
    a.click()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Операции"
        subtitle="Документы Эвотор и начисления лояльности"
        actions={
          <button type="button" onClick={exportCsv} className="rounded-xl border border-line px-3 py-2 text-sm bg-white">
            CSV
          </button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <input
          className="rounded-xl border border-line px-3 py-2 text-sm flex-1 min-w-[140px]"
          placeholder="Поиск: карта / doc id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <select className="rounded-xl border border-line px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          <option value="PROCESSED">PROCESSED</option>
          <option value="FAILED">FAILED</option>
          <option value="RECEIVED">RECEIVED</option>
        </select>
        <button type="button" onClick={load} className="rounded-xl bg-brand text-white px-4 py-2 text-sm">
          Найти
        </button>
      </div>
      {err ? <p className="text-red-600 text-sm">{err}</p> : null}
      {!items.length ? (
        <EmptyState title="Нет документов" description="Измените фильтр или проверьте poll" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line">
                <th className="p-3">Время</th>
                <th>Doc</th>
                <th>Статус</th>
                <th>Карта</th>
                <th className="text-right">Чашки</th>
                <th className="text-right pr-3">₽</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.storeUuid + it.docId} className="border-b border-line/50 hover:bg-slate-50">
                  <td className="p-3 whitespace-nowrap">{formatTs(it.closeDateMs)}</td>
                  <td>
                    <Link className="text-brand" to={`/operations/${encodeURIComponent(it.storeUuid)}/${encodeURIComponent(it.docId)}`}>
                      {shortId(it.docId)}
                    </Link>
                    <span className="text-ink-tertiary text-xs ml-1">{it.kind}</span>
                  </td>
                  <td>
                    <Badge level={it.status === 'FAILED' ? 'bad' : it.status === 'PROCESSED' ? 'ok' : 'neutral'}>{it.status}</Badge>
                  </td>
                  <td>{it.cardCode ?? '—'}</td>
                  <td className="text-right tabular-nums">{it.cups ?? '—'}</td>
                  <td className="text-right pr-3 tabular-nums">{it.resultRub != null ? formatMoneyRub(it.resultRub) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function OperationDetailPage() {
  const { store = '', doc = '' } = useParams()
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    adminFetch(`/operations/${encodeURIComponent(store)}/${encodeURIComponent(doc)}`)
      .then(setData)
      .catch((e) => setErr(e.message))
  }, [store, doc])

  if (err) return <p className="text-red-600 text-sm">{err}</p>
  if (!data) return <p className="text-sm text-ink-secondary">Загрузка…</p>

  return (
    <div className="space-y-4">
      <PageHeader title={`Документ ${shortId(doc, 12)}`} subtitle={store} />
      <div className="rounded-2xl bg-white border border-line p-4 text-sm space-y-2">
        <div>Статус: <Badge level={data.doc.status === 'FAILED' ? 'bad' : 'ok'}>{data.doc.status}</Badge></div>
        <div>Закрыт: {formatTs(data.doc.closeDateMs)}</div>
        {data.doc.lastError ? <div className="text-red-700">Ошибка: {data.doc.lastError}</div> : null}
        {data.op ? (
          <div>
            Ops: cups={data.op.cups}, ₽={formatMoneyRub(data.op.resultRub)}, card={data.op.cardId}
          </div>
        ) : (
          <div className="text-ink-secondary">Нет loyalty_ops для этого документа</div>
        )}
      </div>
      <pre className="text-xs bg-slate-900 text-slate-100 rounded-2xl p-4 overflow-auto max-h-96">{JSON.stringify(data.wl, null, 2)}</pre>
      <Link to="/operations" className="text-brand text-sm">
        ← К списку
      </Link>
    </div>
  )
}
